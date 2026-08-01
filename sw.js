/**
 * Service worker της PWA «Οικοδομή».
 *
 * Στόχος: να ανοίγει η εφαρμογή ΚΑΙ χωρίς σήμα, στο εργοτάξιο.
 *
 * Στρατηγική:
 *  - Πλοήγηση (άνοιγμα της εφαρμογής): network-first με fallback στην cache.
 *    Έτσι ο χρήστης παίρνει πάντα τη νεότερη έκδοση όταν έχει δίκτυο, αλλά
 *    η εφαρμογή ανοίγει κανονικά όταν δεν έχει.
 *  - Στατικά αρχεία (bundle, εικονίδια): cache-first. Τα ονόματα των αρχείων
 *    περιέχουν hash, οπότε δεν υπάρχει κίνδυνος να σερβιριστεί παλιά έκδοση.
 *  - Αιτήματα προς το Supabase: ΔΕΝ τα αγγίζουμε καθόλου. Ο συγχρονισμός
 *    δεδομένων γίνεται από την ουρά (outbox) της ίδιας της εφαρμογής.
 *
 * Όλες οι διαδρομές υπολογίζονται από το scope της εγγραφής, ώστε να δουλεύει
 * και όταν η εφαρμογή σερβίρεται σε υποφάκελο (GitHub Pages).
 */

// Ανέβασε τον αριθμό σε κάθε deploy που αλλάζει συμπεριφορά: το activate
// σβήνει τις παλιές caches, ώστε να μη μείνει κανείς με παλιό bundle.
const CACHE_NAME = 'oikodomi-v2';

/** π.χ. "https://user.github.io/oikodomi-web/" */
const SCOPE = self.registration.scope;
const SHELL_URL = new URL('index.html', SCOPE).toString();
const APP_SHELL = [SCOPE, SHELL_URL, new URL('manifest.json', SCOPE).toString()];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Αν λείπει κάποιο αρχείο δεν ρίχνουμε την εγκατάσταση.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Μόνο ό,τι σερβίρεται από το ίδιο domain. Τα API calls προς το Supabase
  // (άλλο origin) περνούν άθικτα στο δίκτυο.
  if (url.origin !== self.location.origin) return;

  // Ούτε ό,τι βρίσκεται έξω από το scope της εφαρμογής.
  if (!request.url.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

// Επιτρέπει στην εφαρμογή να ζητήσει άμεση ενεργοποίηση νέας έκδοσης.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
