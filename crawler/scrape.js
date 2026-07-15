/**
 * Toronto Independent Cinema Crawler
 * Scrapes showtime data from 6 cinemas and outputs data/showtimes.json
 *
 * Each scraper returns: { cinema: string, movies: [{ title, showtimes: [{dt, tm, id, url}] }] }
 * If a scraper fails, existing data for that cinema is preserved.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
};

const CINEMAS = {
  fox: {
    name: "Fox Theatre", address: "2236 Queen St E",
    lat: 43.6674, lng: -79.3198,
    website: "https://www.foxtheatre.ca",
    showtimesUrl: "https://www.foxtheatre.ca/whats-on/now-showing/"
  },
  revue: {
    name: "Revue Cinema", address: "400 Roncesvalles Ave",
    lat: 43.6485, lng: -79.4534,
    website: "https://revuecinema.ca",
    showtimesUrl: "https://revuecinema.ca/films/"
  },
  paradise: {
    name: "Paradise Theatre", address: "1006c Bloor St W",
    lat: 43.6560, lng: -79.3410,
    website: "https://paradiseonbloor.com",
    showtimesUrl: "https://paradiseonbloor.com/home"
  },
  hotdocs: {
    name: "Hot Docs Cinema", address: "506 Bloor St W",
    lat: 43.6650, lng: -79.4095,
    website: "https://hotdocs.ca",
    showtimesUrl: "https://boxoffice.hotdocs.ca/websales/pages/list.aspx?cp242=KenticoInclude&epguid=a2104450-7e47-4369-a17d-c247570c3939&"
  },
  carlton: {
    name: "Imagine Cinemas Carlton", address: "20 Carlton St",
    lat: 43.6574, lng: -79.3795,
    website: "https://imaginecinemas.com",
    showtimesUrl: "https://imaginecinemas.com/cinema/carlton/"
  },
  tiff: {
    name: "TIFF Lightbox", address: "350 King St W",
    lat: 43.6466, lng: -79.3907,
    website: "https://www.tiff.net",
    showtimesUrl: "https://www.tiff.net/films/"
  }
};

// ============================================
// UTILITY: Get Toronto dates
// ============================================
function getTorontoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

function getNext7Days() {
  const today = getTorontoToday();
  return Array.from({ length: 8 }, (_, i) => addDays(today, i));
}

// Parse time string to HH:MM (24h)
function parseTime(timeStr) {
  if (!timeStr) return null;
  const cleaned = timeStr.trim().toUpperCase();
  // Match patterns like "7:30 PM", "19:30", "7pm"
  const match = cleaned.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const ampm = match[3];
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

// Parse date string and return YYYY-MM-DD
function parseDate(dateStr, year) {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  // Try "Mon Jul 15", "July 15", "Jul 15", "15 Jul", etc.
  const y = year || new Date().getFullYear();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fullMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Match "Month Day" or "Day Month"
  let m = cleaned.match(/(\w+)\s+(\d{1,2})/);
  if (m) {
    let monthStr = m[1].substring(0,3);
    let day = parseInt(m[2]);
    let mi = months.indexOf(monthStr);
    if (mi === -1) {
      mi = fullMonths.findIndex(mo => mo.substring(0,3) === monthStr);
    }
    if (mi >= 0) {
      return `${y}-${String(mi+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  // Match "Day Month"
  m = cleaned.match(/(\d{1,2})\s+(\w+)/);
  if (m) {
    let day = parseInt(m[1]);
    let monthStr = m[2].substring(0,3);
    let mi = months.indexOf(monthStr);
    if (mi >= 0) {
      return `${y}-${String(mi+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  return null;
}

async function fetchPage(url) {
  const resp = await axios.get(url, { headers: HEADERS, timeout: 15000, maxRedirects: 5 });
  return resp.data;
}

// ============================================
// FOX THEATRE SCRAPER
// ============================================
async function scrapeFox() {
  console.log('  [Fox] Fetching showtimes...');
  const html = await fetchPage('https://www.foxtheatre.ca/whats-on/now-showing/');
  const $ = cheerio.load(html);
  const movies = [];

  // Fox Theatre lists movies with showtime links containing event IDs
  // Look for elements that contain movie titles and showtime links
  $('*').each((i, el) => {
    const $el = $(el);
    // Look for links to the ticketing system
    const href = $el.attr('href') || '';
    const ticketMatch = href.match(/evtinfo=(\d+)~/);
    if (ticketMatch) {
      const eventId = ticketMatch[1];
      const timeText = $el.text().trim();
      const tm = parseTime(timeText);
      if (tm) {
        // Try to find the movie title - look up the DOM tree
        let title = '';
        let $parent = $el.closest('[class*="movie"], [class*="film"], [class*="show"], article, .event');
        if ($parent.length === 0) $parent = $el.parent().parent();
        title = $parent.find('h1, h2, h3, h4, .title, .movie-title, .film-title').first().text().trim();
        if (!title) title = $el.parent().find('h1, h2, h3, h4, .title').first().text().trim();
        if (!title) return;

        // Try to find date - look for date elements near the showtime
        let dateStr = '';
        const $dateEl = $parent.find('.date, .show-date, [class*="date"]').first();
        if ($dateEl.length) dateStr = $dateEl.text().trim();

        const dt = dateStr ? parseDate(dateStr) : getTorontoToday();
        if (dt && title) {
          movies.push({
            title: title,
            showtimes: [{ dt, tm, id: eventId }]
          });
        }
      }
    }
  });

  // Deduplicate and merge showtimes per title
  const movieMap = {};
  for (const m of movies) {
    if (!movieMap[m.title]) movieMap[m.title] = { title: m.title, showtimes: [] };
    movieMap[m.title].showtimes.push(...m.showtimes);
  }

  console.log(`  [Fox] Found ${Object.keys(movieMap).length} movies`);
  return { cinema: 'fox', movies: Object.values(movieMap) };
}

// ============================================
// REVUE CINEMA SCRAPER
// ============================================
async function scrapeRevue() {
  console.log('  [Revue] Fetching film list...');
  const html = await fetchPage('https://revuecinema.ca/films/');
  const $ = cheerio.load(html);
  const movies = [];

  // Revue lists films with links to individual pages
  const filmLinks = [];
  $('a[href*="/films/"]').each((i, el) => {
    const href = $(el).attr('href');
    const title = $(el).text().trim();
    if (href && title && title.length > 2 && !filmLinks.find(f => f.href === href)) {
      filmLinks.push({ href, title });
    }
  });

  console.log(`  [Revue] Found ${filmLinks.length} film links, visiting pages...`);

  // Visit each film page (limit to 30 to avoid too many requests)
  for (const link of filmLinks.slice(0, 30)) {
    try {
      await new Promise(r => setTimeout(r, 500)); // Be polite
      const filmHtml = await fetchPage(link.href);
      const $$ = cheerio.load(filmHtml);
      const showtimes = [];

      // Look for showtime links to Agile Ticketing
      $$('a[href*="agileticketing"], a[href*="evtinfo"]').each((i, el) => {
        const href = $$(el).attr('href') || '';
        const match = href.match(/evtinfo=(\d+)~/);
        const timeText = $$(el).text().trim();
        const tm = parseTime(timeText);
        if (match && tm) {
          // Try to find date near this link
          const $parent = $$(el).parent();
          const dateText = $parent.find('.date, [class*="date"], time').first().text().trim() ||
                          $parent.parent().find('.date, [class*="date"], time').first().text().trim();
          const dt = dateText ? parseDate(dateText) : null;
          if (dt) {
            showtimes.push({ dt, tm, id: match[1] });
          }
        }
      });

      // Also look for showtime text without links
      $$('.showtime, [class*="showtime"], [class*="screening"]').each((i, el) => {
        const text = $$(el).text().trim();
        // Try to parse date and time from text
        const days = getNext7Days();
        for (const day of days) {
          const dayDate = new Date(day + 'T12:00:00');
          const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'long' });
          const dayNameShort = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
          const monthDay = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (text.includes(dayName) || text.includes(dayNameShort) || text.includes(monthDay)) {
            const tm = parseTime(text);
            if (tm) {
              showtimes.push({ dt: day, tm, url: link.href });
            }
          }
        }
      });

      if (showtimes.length > 0) {
        // Get description
        const desc = $$('.description, .synopsis, .content, p').first().text().trim().substring(0, 300);
        movies.push({
          title: link.title,
          description: desc || '',
          showtimes
        });
      }
    } catch (e) {
      console.log(`  [Revue] Failed to scrape ${link.title}: ${e.message}`);
    }
  }

  console.log(`  [Revue] Found ${movies.length} movies with showtimes`);
  return { cinema: 'revue', movies };
}

// ============================================
// PARADISE THEATRE SCRAPER
// ============================================
async function scrapeParadise() {
  console.log('  [Paradise] Fetching showtimes...');
  const html = await fetchPage('https://paradiseonbloor.com/home');
  const $ = cheerio.load(html);
  const movies = [];
  const movieMap = {};

  // Paradise uses purchase links like paradiseonbloor.com/purchase/{ID}/
  $('a[href*="/purchase/"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\/purchase\/(\d+)/);
    if (!match) return;
    const eventId = match[1];
    const timeText = $(el).text().trim();
    const tm = parseTime(timeText);
    if (!tm) return;

    // Find movie title - walk up the DOM
    let title = '';
    let $parent = $(el).closest('article, .movie, .film, .event, .showing, [class*="movie"], [class*="film"]');
    if ($parent.length === 0) $parent = $(el).parent().parent();
    title = $parent.find('h1, h2, h3, h4, .title, .movie-title').first().text().trim();
    if (!title) title = $(el).parent().find('h1, h2, h3, h4, .title').first().text().trim();

    // Find date
    let dateStr = '';
    const $dateEl = $parent.find('.date, [class*="date"], time').first();
    if ($dateEl.length) dateStr = $dateEl.text().trim();
    // Also check parent's sibling for date
    if (!dateStr) {
      const $section = $parent.closest('section, .day, [class*="day"]');
      if ($section.length) {
        dateStr = $section.find('.date, [class*="date"], h2, h3').first().text().trim();
      }
    }

    const dt = dateStr ? parseDate(dateStr) : getTorontoToday();
    if (title && dt) {
      if (!movieMap[title]) movieMap[title] = { title, showtimes: [] };
      movieMap[title].showtimes.push({ dt, tm, id: eventId });
    }
  });

  console.log(`  [Paradise] Found ${Object.keys(movieMap).length} movies`);
  return { cinema: 'paradise', movies: Object.values(movieMap) };
}

// ============================================
// HOT DOCS CINEMA SCRAPER
// ============================================
async function scrapeHotDocs() {
  console.log('  [Hot Docs] Fetching showtimes...');
  const url = 'https://boxoffice.hotdocs.ca/websales/pages/list.aspx?cp242=KenticoInclude&epguid=a2104450-7e47-4369-a17d-c247570c3939&';
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const movieMap = {};

  // Hot Docs uses a ticketing system - look for event/film elements
  $('.event, .film, .movie, [class*="event"], [class*="film"], tr, .listing-item').each((i, el) => {
    const $el = $(el);
    const title = $el.find('.title, .name, h1, h2, h3, h4, a').first().text().trim();
    if (!title || title.length < 2) return;

    // Look for showtime links
    $el.find('a[href*="evtinfo"], a[href*="purchase"], a[href*="info.aspx"]').each((j, link) => {
      const href = $(link).attr('href') || '';
      const match = href.match(/evtinfo=(\d+)~/);
      const timeText = $(link).text().trim();
      const tm = parseTime(timeText);
      if (!tm) return;

      // Find date
      const dateText = $el.find('.date, [class*="date"], time').first().text().trim();
      const dt = dateText ? parseDate(dateText) : getTorontoToday();

      if (!movieMap[title]) movieMap[title] = { title, showtimes: [] };
      if (match) {
        movieMap[title].showtimes.push({ dt, tm, id: match[1] });
      } else {
        movieMap[title].showtimes.push({ dt, tm, url: href });
      }
    });

    // Also look for poster images
    if (movieMap[title]) {
      const img = $el.find('img').first();
      if (img.length && !movieMap[title].poster) {
        const src = img.attr('src') || '';
        if (src.startsWith('http')) movieMap[title].poster = src;
        else if (src) movieMap[title].poster = 'https://boxoffice.hotdocs.ca/' + src.replace(/^\//, '');
      }
    }
  });

  console.log(`  [Hot Docs] Found ${Object.keys(movieMap).length} movies`);
  return { cinema: 'hotdocs', movies: Object.values(movieMap) };
}

// ============================================
// IMAGINE CINEMAS CARLTON SCRAPER
// ============================================
async function scrapeCarlton() {
  console.log('  [Carlton] Fetching showtimes...');
  const days = getNext7Days();
  const movieMap = {};

  for (const day of days) {
    try {
      const url = `https://imaginecinemas.com/cinema/carlton/?date=${day}`;
      const html = await fetchPage(url);
      const $ = cheerio.load(html);

      // Look for movie listings
      $('.movie, .film, .listing, [class*="movie"], [class*="film"], article').each((i, el) => {
        const $el = $(el);
        const title = $el.find('.title, .name, h2, h3, h4, a').first().text().trim();
        if (!title || title.length < 2) return;

        // Look for showtime elements
        $el.find('.showtime, [class*="showtime"], [class*="time"], a').each((j, link) => {
          const timeText = $(link).text().trim();
          const tm = parseTime(timeText);
          if (!tm) return;

          if (!movieMap[title]) movieMap[title] = { title, showtimes: [] };
          movieMap[title].showtimes.push({ dt: day, tm });
        });

        // Get poster
        if (movieMap[title]) {
          const img = $el.find('img').first();
          if (img.length && !movieMap[title].poster) {
            const src = img.attr('src') || '';
            if (src.startsWith('http')) movieMap[title].poster = src;
          }
        }
      });

      await new Promise(r => setTimeout(r, 500)); // Be polite
    } catch (e) {
      console.log(`  [Carlton] Failed for ${day}: ${e.message}`);
    }
  }

  console.log(`  [Carlton] Found ${Object.keys(movieMap).length} movies`);
  return { cinema: 'carlton', movies: Object.values(movieMap) };
}

// ============================================
// TIFF SCRAPER (titles only - no showtimes)
// ============================================
async function scrapeTIFF() {
  console.log('  [TIFF] Fetching film list...');
  const html = await fetchPage('https://www.tiff.net/films/');
  const $ = cheerio.load(html);
  const films = [];

  // TIFF is JS-rendered, but try to find film titles in the HTML
  $('a[href*="/films/"], .film-title, .film-card, [class*="film"]').each((i, el) => {
    const title = $(el).find('.title, h2, h3, a').first().text().trim() || $(el).text().trim();
    if (title && title.length > 2 && !films.find(f => f.title === title)) {
      films.push({ title, note: 'Now playing at TIFF Lightbox' });
    }
  });

  // Also try JSON-LD structured data
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.name && item['@type'] === 'Movie') {
          if (!films.find(f => f.title === item.name)) {
            films.push({
              title: item.name,
              director: item.director && typeof item.director === 'object' ? item.director.name : item.director,
              note: 'Now playing at TIFF Lightbox'
            });
          }
        }
      }
    } catch (e) {}
  });

  console.log(`  [TIFF] Found ${films.length} films`);
  return films;
}

// ============================================
// MERGE & ENRICH
// ============================================
function mergeResults(scrapedData, existingData) {
  const cinemaResults = scrapedData.cinemaResults;
  const tiffFilms = scrapedData.tiffFilms;

  // Build a map of existing movies by title (lowercase) for metadata fallback
  const existingByTitle = {};
  for (const m of existingData.movies) {
    existingByTitle[m.title.toLowerCase()] = m;
  }

  // Track which cinemas we successfully scraped
  const scrapedCinemas = new Set(cinemaResults.map(r => r.cinema));

  // Start with existing showtimes for cinemas that weren't scraped
  const allShowtimes = {}; // title -> { cinema -> showtimes }

  for (const m of existingData.movies) {
    const key = m.title.toLowerCase();
    if (!allShowtimes[key]) allShowtimes[key] = { title: m.title, meta: m, cinemas: {} };
    for (const st of m.showtimes) {
      // Only keep existing showtimes for cinemas we DIDN'T scrape
      if (!scrapedCinemas.has(st.c)) {
        if (!allShowtimes[key].cinemas[st.c]) allShowtimes[key].cinemas[st.c] = [];
        allShowtimes[key].cinemas[st.c].push(st);
      }
    }
  }

  // Add scraped showtimes
  for (const result of cinemaResults) {
    for (const movie of result.movies) {
      const key = movie.title.toLowerCase();
      if (!allShowtimes[key]) {
        allShowtimes[key] = { title: movie.title, meta: movie, cinemas: {} };
      }
      // Update metadata if scraped has it
      if (movie.description && !allShowtimes[key].meta.description) {
        allShowtimes[key].meta.description = movie.description;
      }
      if (movie.poster && !allShowtimes[key].meta.poster) {
        allShowtimes[key].meta.poster = movie.poster;
      }
      if (!allShowtimes[key].cinemas[result.cinema]) {
        allShowtimes[key].cinemas[result.cinema] = [];
      }
      allShowtimes[key].cinemas[result.cinema].push(...movie.showtimes);
    }
  }

  // Convert to output format
  const movies = Object.values(allShowtimes).map(entry => {
    const showtimes = [];
    for (const [cinemaId, sts] of Object.entries(entry.cinemas)) {
      // Deduplicate showtimes
      const seen = new Set();
      for (const st of sts) {
        const key = `${st.dt}-${st.tm}-${cinemaId}`;
        if (!seen.has(key)) {
          seen.add(key);
          showtimes.push({ c: cinemaId, ...st });
        }
      }
    }

    // Filter out past showtimes
    const today = getTorontoToday();
    const filtered = showtimes.filter(st => st.dt >= today);

    if (filtered.length === 0) return null;

    const meta = entry.meta || {};
    return {
      title: entry.title,
      description: meta.description || '',
      poster: meta.poster || null,
      director: meta.director,
      year: meta.year,
      runtime: meta.runtime,
      rating: meta.rating,
      genres: meta.genres || [],
      showtimes: filtered.sort((a, b) => {
        if (a.dt !== b.dt) return a.dt.localeCompare(b.dt);
        return (a.tm || '').localeCompare(b.tm || '');
      })
    };
  }).filter(m => m !== null);

  // Use scraped TIFF films if available, otherwise keep existing
  const finalTiffFilms = tiffFilms.length > 0 ? tiffFilms : existingData.tiffFilms;

  return { movies, tiffFilms: finalTiffFilms };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('=== Toronto Cinema Crawler ===');
  console.log(`Date (Toronto): ${getTorontoToday()}`);
  console.log('');

  // Load existing data as fallback
  const dataPath = path.join(__dirname, '..', 'data', 'showtimes.json');
  let existingData;
  try {
    existingData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log(`Loaded existing data: ${existingData.movies.length} movies`);
  } catch (e) {
    console.log('No existing data found, starting fresh');
    existingData = { movies: [], tiffFilms: [] };
  }

  // Scrape each cinema
  const cinemaResults = [];
  const scrapers = [
    { name: 'fox', fn: scrapeFox },
    { name: 'revue', fn: scrapeRevue },
    { name: 'paradise', fn: scrapeParadise },
    { name: 'hotdocs', fn: scrapeHotDocs },
    { name: 'carlton', fn: scrapeCarlton },
  ];

  for (const scraper of scrapers) {
    try {
      const result = await scraper.fn();
      // Only count as success if we got actual data
      if (result.movies.length > 0) {
        cinemaResults.push(result);
        console.log(`  ✓ ${scraper.name}: ${result.movies.length} movies\n`);
      } else {
        console.log(`  ⚠ ${scraper.name}: 0 movies found, keeping existing data\n`);
      }
    } catch (e) {
      console.log(`  ✗ ${scraper.name}: ${e.message}\n`);
    }
  }

  // Scrape TIFF (separate - titles only)
  let tiffFilms = [];
  try {
    tiffFilms = await scrapeTIFF();
  } catch (e) {
    console.log(`  ✗ tiff: ${e.message}\n`);
    tiffFilms = existingData.tiffFilms || [];
  }

  // Merge results
  console.log('Merging results...');
  const merged = mergeResults({ cinemaResults, tiffFilms }, existingData);

  // Build output
  const output = {
    lastUpdated: getTorontoToday(),
    cinemas: CINEMAS,
    movies: merged.movies,
    tiffFilms: merged.tiffFilms
  };

  // Write output
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n=== Done ===`);
  console.log(`Output: ${dataPath}`);
  console.log(`Movies: ${output.movies.length}`);
  console.log(`TIFF films: ${output.tiffFilms.length}`);
  console.log(`Last updated: ${output.lastUpdated}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
