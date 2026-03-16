// Navbar Scroll Effect
const navbar = document.getElementById('navbar');
let lastScrollY = 0;

window.addEventListener('scroll', () => {
  lastScrollY = window.scrollY;
  navbar.classList.toggle('scrolled', lastScrollY > 20);
});

// Mobile Menu Toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');

mobileMenuBtn.addEventListener('click', () => {
  mobileMenu.classList.toggle('active');
});

document.querySelectorAll('.mobile-nav-link').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('active');
  });
});

// Carousel Infinity Scroll & Snapping
const track = document.getElementById('carousel-track');
const container = document.querySelector('.carousel-container');
const prevBtn = document.getElementById('carousel-prev');
const nextBtn = document.getElementById('carousel-next');

if (track && container) {
  const cards = Array.from(track.children);
  
  // Gandakan card lebih banyak (4x) biar scroll-nya terasa benar-benar infinite
  for (let i = 0; i < 4; i++) {
    cards.forEach(card => track.appendChild(card.cloneNode(true)));
  }

 // --- TAMBAHAN: INJECT EASTER EGG DI UJUNG TRACK ---
  const easterEggHTML = `
    <div class="tool-card fade-in-scroll" style="scroll-snap-align: center !important; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; border: none; background-color: black; overflow: hidden; cursor: default;">
      <img src="assets/Whoops.jpg" alt="Smug Spongebob" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.35; z-index: 1; border-radius: inherit;">
      <div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 8px;">
        <h3 style="margin: 0; font-size: 1.1rem; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">You like scrolling, don't you?</h3>
        <p style="margin: 0; font-size: 0.9rem; color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">Whoops! Currently we only have 5 tools built. Another web apps are still cooking in the lab. Stay tuned!</p>
      </div>
    </div>
    
    <div style="flex: 0 0 auto; width: calc(50vw - 405px); pointer-events: none;"></div>
  `;
  track.insertAdjacentHTML('beforeend', easterEggHTML);
  // ------------------------------------------------

  // Fungsi buat ngitung jarak geser (Lebar Card + Gap 24px) secara live
  const getSnapDistance = () => track.children[0].offsetWidth + 24;

  // Scroll pakai wheel mouse
  container.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      if (e.deltaY > 0) {
        container.scrollBy({ left: getSnapDistance(), behavior: 'smooth' });
      } else {
        container.scrollBy({ left: -getSnapDistance(), behavior: 'smooth' });
      }
    }
  }, { passive: false });

  // Tombol Prev & Next
  if (prevBtn && nextBtn) {
    nextBtn.addEventListener('click', () => {
      container.scrollBy({ left: getSnapDistance(), behavior: 'smooth' });
    });
    prevBtn.addEventListener('click', () => {
      container.scrollBy({ left: -getSnapDistance(), behavior: 'smooth' });
    });
  }
}

// Intersection Observer for Animations
const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -100px 0px' };
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, observerOptions);

document.querySelectorAll('.fade-in-scroll').forEach(el => observer.observe(el));

// Contact Form Logic (Email vs WA)
const contactForm = document.getElementById('contact-form');

if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const contactMethod = document.getElementById('contact-method').value.trim();
    const message = document.getElementById('message').value.trim();

    // Deteksi apakah inputnya email (mengandung logo '@')
    const isEmail = contactMethod.includes('@');

    if (isEmail) {
      // LOGIC 1: Buka aplikasi Email
      const targetEmail = "naradevane@gmail.com"; // <-- Ganti kalau lu bikin email naradevane
      const subject = encodeURIComponent(`New Inquiry from ${name}`);
      const body = encodeURIComponent(`Name: ${name}\nEmail: ${contactMethod}\n\nMessage:\n${message}`);
      window.open(`mailto:${targetEmail}?subject=${subject}&body=${body}`);
    } else {
      // LOGIC 2: Lempar ke WhatsApp
      const phoneNumber = "6285163635115"; // <-- GANTI NOMER WA LU DI SINI
      const waText = encodeURIComponent(`Hello, my name is ${name}.\n\n*My Contact:* ${contactMethod}\n*Message:*\n${message}`);
      window.open(`https://wa.me/${phoneNumber}?text=${waText}`, '_blank');
    }

    contactForm.reset();
    
    const formSuccess = document.getElementById('form-success');
    formSuccess.style.display = 'block';
    setTimeout(() => { formSuccess.style.display = 'none'; }, 5000);
  });
}

// ==========================================
// Custom Vertical Scroll Snap with Speed Ramp
// ==========================================
let currentSectionIndex = 0;
const sections = document.querySelectorAll('main section'); // Ngambil semua section
let isScrolling = false;

// Rumus Speed Ramp (easeInOutQuint): Pelan -> Ngebut -> Pelan
function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function scrollToSection(index) {
  // Cegah error kalau index kelewat batas
  if (index < 0 || index >= sections.length) return;

  isScrolling = true;
  currentSectionIndex = index;

  // --- UBAH BAGIAN INI ---
  let targetPosition = sections[index].offsetTop - 80;
  
  // Deteksi kalau ini section paling terakhir (Contact + Footer)
  // Hapus minus 80-nya biar scroll mentok ke dasar layar dan footer ga kepotong
  if (index === sections.length - 1) {
    targetPosition = sections[index].offsetTop; 
  }
  // -----------------------

  const startPosition = window.scrollY;
  const distance = targetPosition - startPosition;
  
  const duration = 150; // Waktu animasi
  let startTime = null;

  function animation(currentTime) {
    // ... (sisa kode animasi di bawahnya biarin sama aja)
    if (startTime === null) startTime = currentTime;
    const timeElapsed = currentTime - startTime;
    const progress = Math.min(timeElapsed / duration, 1);

    // Terapin efek speed ramp ke progress scroll
    const ease = easeInOutQuint(progress);

    window.scrollTo(0, startPosition + distance * ease);

    // Kalau animasi belum selesai, lanjutin
    if (timeElapsed < duration) {
      requestAnimationFrame(animation);
    } else {
      // Kasih jeda dikit sebelum user bisa scroll lagi (mencegah double-scroll di trackpad sensitif)
      setTimeout(() => { isScrolling = false; }, 200); 
    }
  }

  requestAnimationFrame(animation);
}

// Pantau scroll dari mouse wheel / trackpad
window.addEventListener('wheel', (e) => {
  // PENTING: Biarin user tetep bisa scroll horizontal di Carousel tanpa keganggu
  if (e.target.closest('.carousel-container')) return;

  e.preventDefault(); // Matiin scroll bawaan browser
  if (isScrolling) return; // Kalau lagi jalan animasinya, abaikan scroll baru

  // --- TRICK TOUCHPAD (Mencegah bablas ke bawah) ---
  // Trackpad ngirim sisa inersia berupa angka scroll kecil (di bawah 40). 
  // Mouse biasa angkanya selalu gede (biasanya 100).
  // Jadi kalau angkanya kekecilan, kita cuekin aja biar nggak pindah page.
  if (Math.abs(e.deltaY) < 40) return; 
  // ------------------------------------------------

  // Deteksi arah scroll (bawah atau atas)
  if (e.deltaY > 0) {
    scrollToSection(currentSectionIndex + 1); // Scroll Bawah
  } else {
    scrollToSection(currentSectionIndex - 1); // Scroll Atas
  }
}, { passive: false });