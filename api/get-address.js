export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'Koordinat tidak lengkap' });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY; 
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        // 1. PENGAMAN: Kalau Google ga nemu apa-apa di koordinat itu
        if (data.status === 'ZERO_RESULTS' || !data.results || data.results.length === 0) {
             return res.status(200).json({
                success: true,
                jalan: '-', desa: '-', kecamatan: '-', kabupaten: '-', provinsi: '-', kodepos: '-',
                full_address: 'Titik tidak dikenali Google'
            });
        }

        if (data.status !== 'OK') return res.status(400).json({ error: data.error_message || 'Geocoding gagal' });

        const components = data.results[0].address_components;
        let addressData = { jalan: '', desa: '', kecamatan: '', kabupaten: '', provinsi: '', kodepos: '' };

        components.forEach(comp => {
            const types = comp.types;
            if (types.includes('route')) addressData.jalan = comp.long_name;
            if (types.includes('administrative_area_level_4') || types.includes('locality')) addressData.desa = comp.long_name;
            if (types.includes('administrative_area_level_3')) addressData.kecamatan = comp.long_name;
            if (types.includes('administrative_area_level_2')) addressData.kabupaten = comp.long_name;
            if (types.includes('administrative_area_level_1')) addressData.provinsi = comp.long_name;
            if (types.includes('postal_code')) addressData.kodepos = comp.long_name;
        });

        const formattedAddress = data.results[0].formatted_address || '';

        // 2. FALLBACK NAMA JALAN
        if (!addressData.jalan && formattedAddress) {
            const addressParts = formattedAddress.split(',').map(p => p.trim());
            const jalanPart = addressParts.find(part => /^(jl\.|jalan|gg\.|gang)\s/i.test(part));

            if (jalanPart) {
                addressData.jalan = jalanPart;
            } else {
                if (!addressParts[0].includes('+')) addressData.jalan = addressParts[0];
                else if (addressParts.length > 1) addressData.jalan = addressParts[1]; 
            }
        }

        return res.status(200).json({ success: true, ...addressData, full_address: formattedAddress });

    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan di server backend' });
    }
}