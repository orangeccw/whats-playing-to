/**
 * Toronto Independent Cinema Crawler
 * Scrapes showtime data from 8 cinemas and outputs data/showtimes.json
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
  },
  kingsway: {
    name: "Kingsway Theatre", address: "3030 Bloor St W",
    lat: 43.6462, lng: -79.5170,
    website: "http://www.kingswaymovies.ca",
    showtimesUrl: "http://www.kingswaymovies.ca/"
  },
  cinecycle: {
    name: "CineCycle", address: "129 Spadina Ave",
    lat: 43.6495, lng: -79.3700,
    website: "https://www.super8porter.ca/CineCycle.htm",
    showtimesUrl: "https://www.super8porter.ca/CineCycle.htm"
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

// Check if a poster URL is valid (not a Chinese CDN or broken link)
function isValidPoster(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  // Block known Chinese CDNs and image hosts
  const blockedDomains = ['doubaocdn', 'doubanio', 'baidu', 'weibo', 'alicdn', 'chinaz'];
  if (blockedDomains.some(d => lower.includes(d))) return false;
  // Block data URIs and placeholder images
  if (lower.startsWith('data:')) return false;
  if (lower.includes('placeholder') || lower.includes('no-image') || lower.includes('default-')) return false;
  return true;
}

// Extract poster image URL from a Cheerio element
function extractPoster($, $el, baseUrl) {
  // Try multiple strategies to find a poster image
  const candidates = [];
  
  // Strategy 1: Direct img child/descendant
  $el.find('img').each((i, img) => {
    const $img = $(img);
    let src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || '';
    if (!src) return;
    
    // Skip non-poster images
    const lowerSrc = src.toLowerCase();
    if (lowerSrc.includes('data:') || lowerSrc.includes('logo') || lowerSrc.includes('icon') ||
        lowerSrc.includes('banner') || lowerSrc.includes('placeholder') || lowerSrc.includes('default') ||
        lowerSrc.includes('no-image') || lowerSrc.includes('spinner') || lowerSrc.includes('loading') ||
        lowerSrc.includes('pixel.') || lowerSrc.includes('1x1')) return;
    
    // Normalize URL
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) src = baseUrl.replace(/\/$/, '') + src;
    else if (!src.startsWith('http') && baseUrl) src = baseUrl.replace(/\/$/, '') + '/' + src.replace(/^\.\//, '');
    if (!src.startsWith('http')) return;
    
    // Check if it looks like a poster (aspect ratio hints, class names)
    const cls = ($img.attr('class') || '').toLowerCase();
    const alt = ($img.attr('alt') || '').toLowerCase();
    const w = parseInt($img.attr('width') || 0);
    const h = parseInt($img.attr('width') || 0);
    
    // Prefer images that look like posters
    let score = 0;
    if (cls.includes('poster') || cls.includes('poster')) score += 10;
    if (cls.includes('movie') || cls.includes('film')) score += 5;
    if (cls.includes('thumb') || cls.includes('cover')) score += 3;
    if (alt && alt.length > 2) score += 2;
    if (w > 0 && h > 0 && h > w) score += 5; // Portrait orientation
    if (src.includes('poster') || src.includes('cover')) score += 5;
    
    candidates.push({ src, score });
  });
  
  if (candidates.length === 0) return null;
  
  // Sort by score descending, return best
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].src;
}

// ============================================
// TMDB SUPPLEMENT — search for posters & metadata
// ============================================
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w500';

// Cache TMDB results to avoid duplicate lookups
const tmdbCache = {};

async function searchTMDB(title, year) {
  if (!TMDB_API_KEY) return null;
  
  // Clean title for search (remove year, special editions)
  let cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s*—.*$/, '').replace(/\s*:/g, ' ').trim();
  
  if (tmdbCache[cleanTitle]) return tmdbCache[cleanTitle];
  
  try {
    const params = { api_key: TMDB_API_KEY, query: cleanTitle, language: 'en-US', page: 1, include_adult: false };
    if (year) params.primary_release_year = year;
    
    const resp = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 10000, headers: HEADERS });
    if (!resp.data.results || resp.data.results.length === 0) {
      // Try without year filter
      if (year) {
        delete params.primary_release_year;
        const resp2 = await axios.get(`${TMDB_BASE}/search/movie`, { params, timeout: 10000, headers: HEADERS });
        if (!resp2.data.results || resp2.data.results.length === 0) {
          tmdbCache[cleanTitle] = null;
          return null;
        }
        const result = resp2.data.results[0];
        tmdbCache[cleanTitle] = result;
        return result;
      }
      tmdbCache[cleanTitle] = null;
      return null;
    }
    
    const result = resp.data.results[0]; // Take first match
    tmdbCache[cleanTitle] = result;
    return result;
  } catch (e) {
    console.log(`  [TMDB] Search failed for "${cleanTitle}": ${e.message}`);
    tmdbCache[cleanTitle] = null;
    return null;
  }
}

async function enrichWithTMDB(movies) {
  if (!TMDB_API_KEY) {
    console.log('  [TMDB] No API key set (TMDB_API_KEY env var), skipping TMDB enrichment');
    return movies;
  }
  
  console.log(`  [TMDB] Enriching ${movies.length} movies...`);
  let enriched = 0;
  
  for (const movie of movies) {
    // Only call TMDB if missing or invalid poster or metadata
    const needsPoster = !isValidPoster(movie.poster);
    const needsMeta = !movie.director || !movie.year || !movie.genres || movie.genres.length === 0;
    
    if (!needsPoster && !needsMeta) continue;
    
    const tmdbResult = await searchTMDB(movie.title, movie.year);
    if (!tmdbResult) continue;
    
    if (needsPoster && tmdbResult.poster_path) {
      movie.poster = TMDB_IMG_BASE + tmdbResult.poster_path;
    }
    if (needsMeta) {
      if (!movie.director && tmdbResult.credit_cast) {
        const dir = tmdbResult.credit_cast.find(c => c.job === 'Director');
        if (dir) movie.director = dir.name;
      }
      if (!movie.year && tmdbResult.release_date) {
        movie.year = tmdbResult.release_date.substring(0, 4);
      }
      if (!movie.genres || movie.genres.length === 0) {
        // TMDB search doesn't return genres directly, but we can use genre_ids
        const genreMap = {
          28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
          99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
          27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
          10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western'
        };
        if (tmdbResult.genre_ids && tmdbResult.genre_ids.length > 0) {
          movie.genres = tmdbResult.genre_ids.slice(0, 4).map(id => genreMap[id]).filter(Boolean);
        }
      }
    }
    
    enriched++;
    await new Promise(r => setTimeout(r, 250)); // Rate limit: 4 req/sec
  }
  
  console.log(`  [TMDB] Enriched ${enriched}/${movies.length} movies`);
  return movies;
}

// ============================================
// OMDB SUPPLEMENT — search for posters & metadata
// ============================================
const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const OMDB_BASE = 'https://www.omdbapi.com/';

const omdbCache = {};

async function searchOMDB(title, year) {
  if (!OMDB_API_KEY) return null;

  // Clean title for search (remove year, special editions, series info)
  let cleanTitle = title
    .replace(/\s*\(\d{4}\)\s*$/, '')           // Remove "(2009)"
    .replace(/\s*\([^)]*\)\s*$/, '')            // Remove other parenthetical suffixes like "(Restoration)"
    .replace(/\s*—.*$/, '')                     // Remove em-dash suffixes
    .replace(/\s*:\s*\d{1,2}(?:st|nd|rd|th)\s+Anniversary.*$/i, '')  // Remove ": 30th Anniversary"
    .replace(/\s*\(SUB\)\s*$/i, '')             // Remove "(SUB)"
    .trim();
  const cacheKey = `${cleanTitle}|${year || ''}`;

  if (omdbCache[cacheKey] !== undefined) return omdbCache[cacheKey];

  try {
    // OMDb 't' param does exact title match, 'y' filters by year
    const params = { apikey: OMDB_API_KEY, t: cleanTitle, type: 'movie', plot: 'short' };
    if (year) params.y = year;

    const resp = await axios.get(OMDB_BASE, { params, timeout: 10000, headers: HEADERS });
    if (resp.data.Response === 'False') {
      // Try without year
      if (year) {
        delete params.y;
        const resp2 = await axios.get(OMDB_BASE, { params, timeout: 10000, headers: HEADERS });
        if (resp2.data.Response === 'False') {
          omdbCache[cacheKey] = null;
          return null;
        }
        omdbCache[cacheKey] = resp2.data;
        return resp2.data;
      }
      omdbCache[cacheKey] = null;
      return null;
    }

    omdbCache[cacheKey] = resp.data;
    return resp.data;
  } catch (e) {
    console.log(`  [OMDb] Search failed for "${cleanTitle}": ${e.message}`);
    omdbCache[cacheKey] = null;
    return null;
  }
}

async function enrichWithOMDB(movies) {
  if (!OMDB_API_KEY) {
    console.log('  [OMDb] No API key set (OMDB_API_KEY env var), skipping OMDb enrichment');
    return movies;
  }

  console.log(`  [OMDb] Enriching ${movies.length} movies...`);
  let enriched = 0;

  for (const movie of movies) {
    // Only call OMDb if still missing or invalid poster or metadata after TMDB
    const needsPoster = !isValidPoster(movie.poster);
    const needsMeta = !movie.director || !movie.year || !movie.genres || movie.genres.length === 0;

    if (!needsPoster && !needsMeta) continue;

    const omdbResult = await searchOMDB(movie.title, movie.year);
    if (!omdbResult) continue;

    if (needsPoster && omdbResult.Poster && omdbResult.Poster !== 'N/A') {
      movie.poster = omdbResult.Poster;
    }
    if (needsMeta) {
      if (!movie.director && omdbResult.Director && omdbResult.Director !== 'N/A') {
        // OMDb returns "Dir1, Dir2" — take first
        movie.director = omdbResult.Director.split(',')[0].trim();
      }
      if (!movie.year && omdbResult.Year && omdbResult.Year !== 'N/A') {
        movie.year = omdbResult.Year.substring(0, 4);
      }
      if (!movie.runtime && omdbResult.Runtime && omdbResult.Runtime !== 'N/A') {
        movie.runtime = omdbResult.Runtime; // e.g. "120 min"
      }
      if (!movie.rating && omdbResult.Rated && omdbResult.Rated !== 'N/A') {
        movie.rating = omdbResult.Rated;
      }
      if ((!movie.genres || movie.genres.length === 0) && omdbResult.Genre && omdbResult.Genre !== 'N/A') {
        movie.genres = omdbResult.Genre.split(',').map(g => g.trim()).slice(0, 4);
      }
      if (!movie.description && omdbResult.Plot && omdbResult.Plot !== 'N/A') {
        movie.description = omdbResult.Plot;
      }
    }

    enriched++;
    await new Promise(r => setTimeout(r, 1000)); // OMDb rate limit: 1000/day, be polite
  }

  console.log(`  [OMDb] Enriched ${enriched}/${movies.length} movies`);
  return movies;
}

// ============================================
// FOX THEATRE SCRAPER (via WordPress REST API)
// ============================================
async function scrapeFox() {
  console.log('  [Fox] Fetching movies via WP REST API...');
  const movieMap = {};
  let page = 1;
  let hasMore = true;
  let totalSkippedNoDate = 0, totalSkippedPast = 0;

  while (hasMore && page <= 3) {
    const url = `https://www.foxtheatre.ca/wp-json/wp/v2/movies?per_page=100&page=${page}&_fields=id,title,excerpt,link,class_list,yoast_head_json`;
    let resp;
    try {
      resp = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    } catch (e) {
      console.log(`  [Fox] API fetch failed (page ${page}): ${e.message}`);
      break;
    }

    const movies = resp.data;
    if (!Array.isArray(movies) || movies.length === 0) {
      console.log(`  [Fox] Page ${page}: empty response, total=${resp.headers['x-wp-total'] || '?'}`);
      hasMore = false;
      break;
    }

    console.log(`  [Fox] Page ${page}: ${movies.length} movies, total=${resp.headers['x-wp-total'] || '?'}`);
    let skippedNoDate = 0, skippedPast = 0;

    for (const movie of movies) {
      const title = movie.title?.rendered?.trim();
      if (!title) continue;

      // Extract poster from Yoast OG image
      let poster = null;
      const ogImages = movie.yoast_head_json?.og_image;
      if (Array.isArray(ogImages) && ogImages.length > 0) {
        poster = ogImages[0].url;
      }

      // Extract description (strip HTML tags)
      let description = '';
      if (movie.excerpt?.rendered) {
        description = movie.excerpt.rendered.replace(/<[^>]+>/g, '').replace(/\[&hellip;\]/g, '...').trim();
      }

      // Extract screening dates from class_list (e.g., "event-date-2026-07-15")
      const classList = movie.class_list || [];
      const dates = [];
      for (const cls of classList) {
        const m = cls.match(/^event-date-(\d{4}-\d{2}-\d{2})$/);
        if (m) dates.push(m[1]);
      }

      if (dates.length === 0) { skippedNoDate++; continue; }

      // Filter to today and future dates only
      const today = getTorontoToday();
      const futureDates = dates.filter(d => d >= today);
      if (futureDates.length === 0) { skippedPast++; continue; }

      if (!movieMap[title]) {
        movieMap[title] = {
          title,
          description,
          poster,
          showtimes: []
        };
      }
      if (poster && !movieMap[title].poster) movieMap[title].poster = poster;
      if (description && !movieMap[title].description) movieMap[title].description = description;

      // Create showtime entry for each date (no specific time available from API)
      for (const dt of futureDates) {
        movieMap[title].showtimes.push({ dt, url: movie.link });
      }
    }

    totalSkippedNoDate += skippedNoDate;
    totalSkippedPast += skippedPast;

    // Check if there are more pages
    const totalPages = parseInt(resp.headers['x-wp-totalpages'] || '1');
    hasMore = page < totalPages;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  [Fox] Found ${Object.keys(movieMap).length} movies${totalSkippedNoDate > 0 || totalSkippedPast > 0 ? ` (skipped: ${totalSkippedNoDate} no date, ${totalSkippedPast} past)` : ''}`);
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

  // Revue uses .movie-card containers with h5 titles and date/time text
  $('.movie-card').each((i, card) => {
    const $card = $(card);

    // Get title and film page URL from h5 > a
    const $titleLink = $card.find('h5 a').first();
    const title = $titleLink.text().trim();
    const filmUrl = $titleLink.attr('href') || '';
    if (!title || title.length < 2) return;

    // Get poster from img data-src (lazy loaded)
    let poster = null;
    const $img = $card.find('img').first();
    if ($img.length) {
      poster = $img.attr('data-src') || $img.attr('src') || '';
      if (poster.startsWith('data:')) poster = $img.attr('data-src') || null;
      if (poster && !poster.startsWith('http')) {
        poster = 'https://revuecinema.ca' + (poster.startsWith('/') ? poster : '/' + poster);
      }
    }

    // Get showtimes from date/time text elements
    // Format: "Tue Jul 14, 06:30 PM"
    const showtimes = [];
    $card.find('.brxe-text-basic, .brxe-ndxpjc').each((j, dt) => {
      const text = $(dt).text().trim();
      if (!text) return;

      // Split on comma: "Tue Jul 14, 06:30 PM" → date="Tue Jul 14", time="06:30 PM"
      const parts = text.split(',');
      if (parts.length >= 2) {
        const datePart = parts[0].trim();
        const timePart = parts.slice(1).join(',').trim();
        const dt_val = parseDate(datePart);
        const tm = parseTime(timePart);
        if (dt_val && tm) {
          showtimes.push({ dt: dt_val, tm, url: filmUrl });
        }
      } else {
        // Try parsing the whole string
        const dt_val = parseDate(text);
        const tm = parseTime(text);
        if (dt_val && tm) {
          showtimes.push({ dt: dt_val, tm, url: filmUrl });
        }
      }
    });

    if (showtimes.length > 0) {
      movies.push({
        title,
        poster: poster || undefined,
        showtimes
      });
    }
  });

  console.log(`  [Revue] Found ${movies.length} movies with showtimes`);
  return { cinema: 'revue', movies };
}

// ============================================
// PARADISE THEATRE SCRAPER
// ============================================
async function scrapeParadise() {
  console.log('  [Paradise] Fetching showtimes...');
  const baseUrl = 'https://paradiseonbloor.com';
  const movieMap = {};

  // Fetch main page to discover date tabs
  const mainHtml = await fetchPage(baseUrl + '/home');
  const $main = cheerio.load(mainHtml);

  // Find date tab links (e.g., /home/2026-07-15)
  const dateUrls = [];
  $main('a[href*="/home/"]').each((i, el) => {
    const href = $main(el).attr('href') || '';
    const match = href.match(/\/home\/(\d{4}-\d{2}-\d{2})/);
    if (match && !dateUrls.find(d => d.url === href)) {
      dateUrls.push({ url: href, dt: match[1] });
    }
  });

  // If no date tabs found, use today's date with the main page
  if (dateUrls.length === 0) {
    dateUrls.push({ url: baseUrl + '/home', dt: getTorontoToday() });
  }

  console.log(`  [Paradise] Found ${dateUrls.length} date pages`);

  // Build a poster map from .show divs (title → poster URL)
  const posterMap = {};
  $main('.show').each((i, el) => {
    const $show = $main(el);
    const title = $show.find('h2').first().text().trim();
    if (!title) return;
    const style = $show.attr('style') || '';
    const bgMatch = style.match(/--show-background-image:\s*url\(([^)]+)\)/);
    if (bgMatch) posterMap[title.toLowerCase()] = bgMatch[1];
  });

  // Fetch each date page
  for (const { url, dt } of dateUrls.slice(0, 7)) {
    try {
      const fullUrl = url.startsWith('http') ? url : baseUrl + url;
      const html = await fetchPage(fullUrl);
      const $ = cheerio.load(html);

      // Paradise restructured: showtimes are in .panel divs, not .show divs
      // Each .panel may contain an <h2> (movie title) and .showtime elements
      $('.panel').each((i, el) => {
        const $panel = $(el);
        const $showtimes = $panel.find('.showtime');
        if ($showtimes.length === 0) return; // Skip panels without showtimes

        const title = $panel.find('h2').first().text().trim();
        if (!title || title === 'Movies Coming Soon' || title === 'Paradise Presents' ||
            title === 'Upcoming Series' || title === 'Discover everything Paradise has to offer') return;

        // Get poster from our map (built from .show divs on the main page)
        const poster = posterMap[title.toLowerCase()] || null;

        if (!movieMap[title]) {
          movieMap[title] = { title, showtimes: [], poster };
        }
        if (poster && !movieMap[title].poster) movieMap[title].poster = poster;

        // Parse each showtime element
        $showtimes.each((j, st) => {
          const $st = $(st);
          const timeText = $st.text().trim().replace(/SOLD OUT/i, '').trim();
          const tm = parseTime(timeText);
          if (!tm) return;

          const href = $st.attr('href') || '';
          const idMatch = href.match(/\/purchase\/(\d+)/);
          const showtimeId = $st.attr('data-showtime_id') || (idMatch ? idMatch[1] : '');
          const isSoldOut = ($st.attr('title') || '').includes('SOLD OUT') ||
                            $st.hasClass('sold-out') ||
                            $st.text().includes('SOLD OUT');

          const showtime = { dt, tm };
          if (showtimeId) showtime.id = showtimeId;
          if (href && href.includes('/purchase/')) showtime.url = href;
          if (isSoldOut) showtime.soldOut = true;

          movieMap[title].showtimes.push(showtime);
        });
      });

      // Also try the old .show structure as fallback
      $('.show .showtime').each((i, st) => {
        const $st = $(st);
        const $show = $st.closest('.show');
        const title = $show.find('h2').first().text().trim();
        if (!title) return;

        const timeText = $st.text().trim().replace(/SOLD OUT/i, '').trim();
        const tm = parseTime(timeText);
        if (!tm) return;

        if (!movieMap[title]) {
          movieMap[title] = { title, showtimes: [], poster: null };
        }

        const href = $st.attr('href') || '';
        const idMatch = href.match(/\/purchase\/(\d+)/);
        const showtimeId = $st.attr('data-showtime_id') || (idMatch ? idMatch[1] : '');
        const isSoldOut = ($st.attr('title') || '').includes('SOLD OUT') ||
                          $st.hasClass('sold-out') ||
                          $st.text().includes('SOLD OUT');

        const showtime = { dt, tm };
        if (showtimeId) showtime.id = showtimeId;
        if (href && href.includes('/purchase/')) showtime.url = href;
        if (isSoldOut) showtime.soldOut = true;

        movieMap[title].showtimes.push(showtime);
      });

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`  [Paradise] Failed for ${dt}: ${e.message}`);
    }
  }

  console.log(`  [Paradise] Found ${Object.keys(movieMap).length} movies`);
  return { cinema: 'paradise', movies: Object.values(movieMap) };
}

// ============================================
// HOT DOCS CINEMA SCRAPER (via JSON-LD structured data)
// ============================================
async function scrapeHotDocs() {
  console.log('  [Hot Docs] Fetching showtimes...');
  const url = 'https://boxoffice.hotdocs.ca/websales/pages/list.aspx?cp242=KenticoInclude&epguid=a2104450-7e47-4369-a17d-c247570c3939&';
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const movieMap = {};

  // Parse JSON-LD structured data for events
  const events = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Event' && item.name && item.startDate) {
          events.push(item);
        }
      }
    } catch (e) {}
  });

  // Also collect poster images from the page (from agileticketing.net CDN)
  // Build a map of alt text → poster URL for matching
  const posterByAlt = {};
  const posterList = [];
  $('img').each((i, img) => {
    const src = $(img).attr('src') || '';
    const alt = ($(img).attr('alt') || '').trim();
    if (src.includes('agileticketing.net') && src.includes('_thumb')) {
      const fullSrc = src.replace('_thumb', '');
      posterList.push(fullSrc);
      if (alt) posterByAlt[alt.toLowerCase()] = fullSrc;
    }
  });

  console.log(`  [Hot Docs] Found ${events.length} JSON-LD events, ${posterList.length} posters`);

  // Process events
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const title = event.name.trim();
    if (!title) continue;

    // Try to find poster: 1) event.image from JSON-LD, 2) match by alt text, 3) null
    let poster = null;
    if (event.image && typeof event.image === 'string') {
      poster = event.image;
    } else if (posterByAlt[title.toLowerCase()]) {
      poster = posterByAlt[title.toLowerCase()];
    } else {
      // Try partial match
      for (const [alt, src] of Object.entries(posterByAlt)) {
        if (alt.includes(title.toLowerCase()) || title.toLowerCase().includes(alt)) {
          poster = src;
          break;
        }
      }
    }

    // Parse date and time from startDate (e.g., "2026-07-17T07:00:00-04:00")
    const startDate = new Date(event.startDate);
    const dt = startDate.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const tm = String(startDate.getHours()).padStart(2, '0') + ':' + String(startDate.getMinutes()).padStart(2, '0');

    // Extract event ID from ticket URL
    let eventId = '';
    let ticketUrl = '';
    if (event.offers && event.offers.url) {
      ticketUrl = event.offers.url;
      const match = ticketUrl.match(/evtinfo=(\d+)~/);
      if (match) eventId = match[1];
    }

    if (!movieMap[title]) {
      movieMap[title] = {
        title,
        poster,
        showtimes: []
      };
    } else if (poster && !isValidPoster(movieMap[title].poster)) {
      movieMap[title].poster = poster;
    }

    const showtime = { dt, tm };
    if (eventId) showtime.id = eventId;
    if (ticketUrl) showtime.url = ticketUrl;
    movieMap[title].showtimes.push(showtime);
  }

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
// KINGSWAY THEATRE SCRAPER (parse image alt texts)
// ============================================
async function scrapeKingsway() {
  console.log('  [Kingsway] Fetching showtimes...');
  const html = await fetchPage('http://www.kingswaymovies.ca/');
  const $ = cheerio.load(html);
  const movieMap = {};

  // Kingsway stores movie data in image alt attributes
  // Format: "Movie Title day_pattern time(s)"
  // e.g., "Michael daily 3:10 pm 7:15 pm"
  //       "Romeria Sat Mon Wed 7:00 pm"
  $('img').each((i, img) => {
    const alt = $(img).attr('alt') || '';
    const src = $(img).attr('src') || '';

    // Skip navigation buttons and theatre photos
    if (alt.includes('Button') || alt.includes('Kingsway Theatre Toronto') ||
        alt.includes('Clicky') || alt.includes('Analytics') || alt.length < 10) return;

    // Parse: "Movie Title [day_pattern] time(s)"
    // Times are always at the end, format like "7:00 pm" or "3:10 pm 7:15 pm"
    const timeRegex = /(\d{1,2}:\d{2}\s*[ap]m)/gi;
    const times = alt.match(timeRegex);
    if (!times || times.length === 0) return;

    // Remove times from alt to get title + day pattern
    const beforeTimes = alt.replace(timeRegex, '').trim();

    // Extract day pattern: "daily", "Sat Mon Wed", "Fri Sun Tues Thurs", etc.
    const dayPatternMatch = beforeTimes.match(/(daily|Sat|Sun|Mon|Tue|Tues|Wed|Thu|Thurs|Fri)\s*(?:Sun|Mon|Tue|Tues|Wed|Thu|Thurs|Fri)*\s*(?:Sun|Mon|Tue|Tues|Wed|Thu|Thurs|Fri)*/i);
    let dayPattern = '';
    let title = beforeTimes;
    if (dayPatternMatch) {
      dayPattern = dayPatternMatch[0].trim();
      title = beforeTimes.substring(0, beforeTimes.indexOf(dayPattern)).trim();
    }

    // Clean up title — remove trailing "35mm FILM Dolby stereo Soune" type notes
    title = title.replace(/\s+(35mm|70mm|film|dolby|stereo|soune|digital)\b.*$/i, '').trim();
    if (!title || title.length < 2) return;

    // Parse times to HH:MM format
    const parsedTimes = times.map(t => {
      const m = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      if (!m) return null;
      let h = parseInt(m[1]);
      const min = m[2];
      const ap = m[3].toLowerCase();
      if (ap === 'pm' && h !== 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      return String(h).padStart(2, '0') + ':' + min;
    }).filter(Boolean);

    // Build poster URL
    let poster = null;
    if (src && src.includes('/images/') && !src.includes('Button') && !src.includes('KH')) {
      poster = src.startsWith('http') ? src : 'http://www.kingswaymovies.ca/' + src.replace(/^\//, '');
    }

    // Determine which days to create showtimes for
    const today = getTorontoToday();
    const todayDate = new Date(today + 'T12:00:00');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const showtimes = [];
    for (let d = 0; d < 7; d++) {
      const checkDate = new Date(todayDate);
      checkDate.setDate(checkDate.getDate() + d);
      const dt = checkDate.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      const dayName = dayNames[checkDate.getDay()];

      let matches = false;
      if (dayPattern.toLowerCase() === 'daily') {
        matches = true;
      } else {
        // Check if day name is in the pattern
        const patternDays = dayPattern.split(/\s+/).map(s => s.trim());
        if (patternDays.includes(dayName) || patternDays.includes(dayName + 's')) {
          matches = true;
        }
        // Handle "Tues" vs "Tue"
        if (patternDays.includes('Tues') && dayName === 'Tue') matches = true;
        if (patternDays.includes('Thu') && (dayName === 'Thu')) matches = true;
        if (patternDays.includes('Thurs') && dayName === 'Thu') matches = true;
      }

      if (matches) {
        for (const tm of parsedTimes) {
          showtimes.push({ dt, tm });
        }
      }
    }

    if (showtimes.length === 0) return;

    if (!movieMap[title]) {
      movieMap[title] = { title, showtimes: [], poster };
    }
    if (poster && !movieMap[title].poster) movieMap[title].poster = poster;
    movieMap[title].showtimes.push(...showtimes);
  });

  console.log(`  [Kingsway] Found ${Object.keys(movieMap).length} movies`);
  return { cinema: 'kingsway', movies: Object.values(movieMap) };
}

// ============================================
// CINECYCLE / SUPER 8 PORTER SCRAPER
// ============================================
async function scrapeCineCycle() {
  console.log('  [CineCycle] Fetching events...');
  const html = await fetchPage('https://www.super8porter.ca/CineCycle.htm');
  const $ = cheerio.load(html);
  const movies = [];

  // CineCycle is a very irregular venue with occasional events.
  // Events appear in plain text within the page.
  // Look for patterns like "Friday, June 26, 7pm" or "Sunday, July 27, 7pm"
  const fullText = $('body').text();

  // Find all date+time patterns with associated film titles
  // Pattern: "Film Title (Director, Country, Year, ...)" followed by date/time
  // Or: "Film Title" then "Day, Month Day, Time"

  // Strategy: find links that look like film titles near date/time text
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Look for event blocks: "Film Title" followed by date pattern
  const datePattern = /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2}\s*[ap]m)/g;
  let match;

  // Get all text nodes and their surrounding context
  $('a').each((i, el) => {
    const $link = $(el);
    const linkText = $link.text().trim();
    const href = $link.attr('href') || '';

    // Skip navigation links
    if (linkText.length < 3 || ['Upcoming Events', 'Past Events', 'Location & Contact',
        'Services', 'History', 'Film Collection', 'Scopitones', 'flickr Photos',
        'Projectors', 'Links', 'Press', 'Pianist Wanted', 'Map', 'CineCycle',
        'CFMDC', 'super8porter', 'Facebook', 'Facebook Group', 'Facebook Page',
        'Facebook Events', '401', 'Photos', 'Photo', 'story', 'logo'].includes(linkText)) return;

    // Check if this link text looks like a film title (has letters and is reasonably long)
    if (!/[a-zA-Z]{3,}/.test(linkText)) return;

    // Get the parent element and surrounding text
    const $parent = $link.parent();
    const parentText = $parent.text();

    // Look for date pattern near this link
    const nearbyDate = parentText.match(datePattern);
    if (nearbyDate) {
      for (const dateStr of nearbyDate) {
        const parts = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2})\s*(am|pm)/i);
        if (!parts) continue;

        const monthName = parts[1];
        const dayNum = parseInt(parts[2]);
        const timeStr = parts[3];
        const ampm = parts[4];

        // Find month index
        let monthIdx = monthAbbr.indexOf(monthName);
        if (monthIdx === -1) monthIdx = monthNames.indexOf(monthName);
        if (monthIdx === -1) continue;

        // Build date string for current year
        const year = 2026;
        const dt = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

        // Parse time
        let h = parseInt(timeStr.split(':')[0]);
        const min = timeStr.split(':')[1];
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
        const tm = String(h).padStart(2, '0') + ':' + min;

        // Only include future dates
        const today = getTorontoToday();
        if (dt < today) continue;

        // Check if already added
        const existing = movies.find(m => m.title === linkText);
        if (existing) {
          existing.showtimes.push({ dt, tm, url: href });
        } else {
          movies.push({
            title: linkText,
            showtimes: [{ dt, tm, url: href || 'https://www.super8porter.ca/CineCycle.htm' }]
          });
        }
      }
    }
  });

  // Also check for plain text events (not wrapped in links)
  // Look for patterns like "Love Lies Bleeding (Rose Glass, USA, 2024, video, 104 min.)" + date
  const textBlocks = $('td, p, div, span').toArray();
  for (const block of textBlocks) {
    const text = $(block).text().trim();
    // Pattern: film name followed by director info in parens, then date
    const filmMatch = text.match(/^([A-Z][^()]{3,60})\s*\(([^)]+)\)/);
    if (!filmMatch) continue;

    const filmTitle = filmMatch[1].trim();
    const filmInfo = filmMatch[2];

    // Skip if already found via links
    if (movies.find(m => m.title === filmTitle)) continue;

    // Look for date in nearby text
    const dateMatch = text.match(datePattern);
    if (!dateMatch) continue;

    for (const dateStr of dateMatch) {
      const parts = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2})\s*(am|pm)/i);
      if (!parts) continue;

      const monthName = parts[1];
      const dayNum = parseInt(parts[2]);
      const timeStr = parts[3];
      const ampm = parts[4];

      let monthIdx = monthAbbr.indexOf(monthName);
      if (monthIdx === -1) monthIdx = monthNames.indexOf(monthName);
      if (monthIdx === -1) continue;

      const year = 2026;
      const dt = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

      let h = parseInt(timeStr.split(':')[0]);
      const min = timeStr.split(':')[1];
      if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
      if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
      const tm = String(h).padStart(2, '0') + ':' + min;

      const today = getTorontoToday();
      if (dt < today) continue;

      const existing = movies.find(m => m.title === filmTitle);
      if (existing) {
        existing.showtimes.push({ dt, tm });
      } else {
        movies.push({ title: filmTitle, showtimes: [{ dt, tm }] });
      }
    }
  }

  console.log(`  [CineCycle] Found ${movies.length} upcoming events`);
  return { cinema: 'cinecycle', movies };
}

// ============================================
// TIFF SCRAPER (via Puppeteer for JS-rendered page)
// ============================================
async function scrapeTIFF() {
  console.log('  [TIFF] Fetching film list via Puppeteer...');
  const films = [];

  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    console.log('  [TIFF] Loading page...');
    await page.goto('https://www.tiff.net/films/', { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for film cards to render
    await page.waitForSelector('[class*="cardTitle"]', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    // Extract film data from rendered DOM
    const cardData = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="cardTitle"]');
      const results = [];
      const seen = new Set();

      cards.forEach(card => {
        const link = card.querySelector('a[href*="/films/"]') || card.closest('a[href*="/films/"]');
        const title = card.textContent.trim();
        const href = link ? link.getAttribute('href') : '';

        if (title && title.length > 1 && !seen.has(href)) {
          seen.add(href);

          // Find poster image (background-image in cardImg div)
          const cardContainer = card.closest('[class*="card"]');
          let poster = '';
          if (cardContainer) {
            const imgDiv = cardContainer.querySelector('[class*="cardImg"]');
            if (imgDiv) {
              const bgStyle = imgDiv.style.backgroundImage || '';
              const match = bgStyle.match(/url\(["']?(.*?)["']?\)/);
              if (match) {
                let url = match[1];
                if (url.startsWith('//')) url = 'https:' + url;
                poster = url;
              }
            }
            // Also try to get director/subtitle
            const subtitle = cardContainer.querySelector('[class*="cardSubtitle"]');
            const director = subtitle ? subtitle.textContent.trim() : '';
            results.push({ title, href, poster, director });
          } else {
            results.push({ title, href, poster: '', director: '' });
          }
        }
      });

      return results;
    });

    // Add films to list
    for (const card of cardData) {
      if (card.title && card.title.length > 1) {
        films.push({
          title: card.title,
          director: card.director || undefined,
          poster: card.poster || undefined,
          note: 'TIFF'
        });
      }
    }

    // Also try to get schedule data (click on Schedule view tab)
    try {
      console.log('  [TIFF] Trying schedule view...');
      // Click schedule tab
      const scheduleClicked = await page.evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"], [aria-label*="Schedule"]');
        for (const tab of tabs) {
          if (tab.textContent.includes('Schedule') || tab.getAttribute('aria-label')?.includes('Schedule')) {
            tab.click();
            return true;
          }
        }
        return false;
      });

      if (scheduleClicked) {
        await new Promise(r => setTimeout(r, 3000));

        // Extract schedule items
        const scheduleData = await page.evaluate(() => {
          const items = [];
          const rows = document.querySelectorAll('.row, [class*="visItem"]');
          rows.forEach(row => {
            const text = row.textContent.replace(/\s+/g, ' ').trim();
            const timeMatch = text.match(/^(\d{1,2}:\d{2}\s*[ap]m)/i);
            if (timeMatch) {
              const link = row.querySelector('a[href*="/films/"]');
              items.push({
                time: timeMatch[1],
                text: text.substring(timeMatch[1].length).trim(),
                href: link ? link.getAttribute('href') : ''
              });
            }
          });
          return items;
        });

        console.log(`  [TIFF] Found ${scheduleData.length} schedule items`);
        // Note: schedule items don't have explicit dates in the DOM,
        // they're organized by day sections. We'll add them as reference info.
      }
    } catch (e) {
      console.log(`  [TIFF] Schedule view failed: ${e.message}`);
    }

  } catch (e) {
    console.log(`  [TIFF] Puppeteer failed: ${e.message}`);
    console.log('  [TIFF] Falling back to static HTML...');
    // Fallback: try static HTML
    try {
      const html = await fetchPage('https://www.tiff.net/films/');
      const $ = cheerio.load(html);
      $('a[href*="/films/"]').each((i, el) => {
        const title = $(el).text().trim();
        if (title && title.length > 2 && !films.find(f => f.title === title)) {
          films.push({ title, note: 'TIFF' });
        }
      });
    } catch (e2) {
      console.log(`  [TIFF] Static fallback also failed: ${e2.message}`);
    }
  } finally {
    if (browser) await browser.close();
  }

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
      // Update metadata if scraped has it (only set poster if existing is invalid)
      if (movie.description && !allShowtimes[key].meta.description) {
        allShowtimes[key].meta.description = movie.description;
      }
      if (isValidPoster(movie.poster) && !isValidPoster(allShowtimes[key].meta.poster)) {
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
    { name: 'kingsway', fn: scrapeKingsway },
    { name: 'cinecycle', fn: scrapeCineCycle },
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

  // Enrich with TMDB (posters + metadata) if API key is set
  console.log('TMDB enrichment...');
  await enrichWithTMDB(merged.movies);

  // Enrich with OMDb (fills in gaps TMDB missed)
  console.log('OMDb enrichment...');
  await enrichWithOMDB(merged.movies);

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
