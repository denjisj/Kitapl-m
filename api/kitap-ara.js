// Kitaplığım — Türkçe kitap arama (Vercel sunucu fonksiyonu)
// GET /api/kitap-ara?q=altın oğul pierce brown   veya   /api/kitap-ara?isbn=9786053437178
// Gerekli (biri yeter): Vercel > Settings > Environment Variables
//   EXA_API_KEY   — ücretsiz, kart istemez (dashboard.exa.ai)  ← önerilen
//   BRAVE_API_KEY — kart ister, aylık 5$ kredi
//
// Arama motoruyla yalnızca Türk kitapçılarında arar. Sayfa okumaya izin veren sitelerde
// (BKM Kitap, 1000Kitap) ürün sayfasından kapak, ISBN, sayfa, yayınevi okunur;
// diğerlerinde yalnızca arama sonucundaki başlık ve küçük resim kullanılır.
// Sonuçlar Vercel önbelleğinde 30 gün tutulur.

const UA = 'KitaplikBot/1.0 (+https://kitapsay.vercel.app; kisisel kitaplik uygulamasi)';
const SITES = [
  { host: 'bkmkitap.com',   ad: 'BKM Kitap',   oku: true,  yol: /^\/[a-z0-9-]+$/ },
  { host: '1000kitap.com',  ad: '1000Kitap',   oku: true,  yol: /^\/kitap\// },
  { host: 'kitapyurdu.com', ad: 'Kitapyurdu',  oku: false, yol: /^\/kitap\// },
  { host: 'dr.com.tr',      ad: 'D&R',         oku: false, yol: /^\/kitap\// },
  { host: 'idefix.com',     ad: 'idefix',      oku: false, yol: /-p-\d+/ },
  { host: 'nadirkitap.com', ad: 'Nadir Kitap', oku: false, yol: /kitap\d+\.html$/ },
];
const KUYRUK = /\s*[-|–—]\s*(bkm ?kitap|kitapyurdu(\.com)?|d&r|dr\.com\.tr|idefix|nadir ?kitap|1000 ?kitap|en uygun fiyat.*|fiyatı.*|satın al.*|kitabı.*)$/i;

const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))
         || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
  return m ? decode(m[1]) : '';
};
const isbnIn = s => { const m = String(s || '').replace(/[-\s]/g, '').match(/97[89]\d{10}/); return m ? m[0] : ''; };
const temizBaslik = t => decode(t).replace(KUYRUK, '').replace(KUYRUK, '').replace(/\s*\((ciltli|ciltsiz|karton kapak)\)\s*/ig, ' ').trim();

function metindenOku(text) {
  const t = ' ' + String(text || '').replace(/\s+/g, ' ') + ' ';
  const g = re => { const m = t.match(re); return m ? m[1].trim() : ''; };
  return {
    isbn: isbnIn(g(/(?:ISBN|Barkod)\s*[:\-]?\s*([\d\s-]{13,20})/i)) || '',
    sayfa: parseInt(g(/Sayfa Say[ıi]s[ıi]\s*[:\-]?\s*(\d{2,4})/i) || g(/(\d{2,4})\s*sayfa/i)) || null,
    yayinevi: g(/Yay[ıi]nevi\s*[:\-]?\s*([A-ZÇĞİÖŞÜ0-9][^:|•\n]{1,40}?)(?=\s+(?:Yazar|Çevirmen|Sayfa|ISBN|Barkod|Bas[ıi]m|Dil|Kapak|Cilt|Kağıt|Boyut|Ebat|Kategori)|\s*$)/),
    yazar: g(/Yazar\s*[:\-]?\s*([A-ZÇĞİÖŞÜ][^:|•\n]{1,40}?)(?=\s+(?:Yay[ıi]nevi|Çevirmen|Sayfa|ISBN|Barkod|Bas[ıi]m|Dil|Kategori)|\s*$)/),
    yil: g(/(?:Bas[ıi]m Tarihi|Yay[ıi]n Tarihi|Bas[ıi]m Y[ıi]l[ıi])\s*[:\-]?\s*[^0-9]{0,12}((?:19|20)\d{2})/i),
  };
}

async function exaAra(sorgu, key) {
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST', signal: zamanAsimi(8000),
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query: sorgu, type: 'auto', numResults: 10,
      includeDomains: SITES.map(s => s.host), contents: { text: { maxCharacters: 3000 } } }),
  });
  if (!r.ok) throw new Error('Exa ' + r.status);
  const j = await r.json();
  return (j.results || []).map(x => ({ title: x.title || '', url: x.url, description: '', text: x.text || '', image: x.image || '', author: x.author || '' }));
}
async function braveAra(sorgu, key) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(sorgu)}&country=tr&search_lang=tr&count=20&safesearch=moderate`,
    { headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }, signal: zamanAsimi(6000) });
  if (!r.ok) throw new Error('Brave ' + r.status);
  const j = await r.json();
  return ((j.web && j.web.results) || []).map(w => ({ title: w.title, url: w.url, description: decode((w.description || '') + ' ' + (w.extra_snippets || []).join(' ')),
    text: '', image: (w.thumbnail && (w.thumbnail.original || w.thumbnail.src)) || '', author: '' }));
}

function zamanAsimi(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

async function sayfaOku(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: zamanAsimi(4500) });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 800000);
    const d = {};
    // JSON-LD (Book / Product)
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        let j = JSON.parse(m[1].trim()); const arr = Array.isArray(j) ? j : (j['@graph'] || [j]);
        for (const o of arr) {
          const t = [].concat(o['@type'] || []).join(',');
          if (!/Book|Product/i.test(t)) continue;
          d.baslik = d.baslik || decode(o.name);
          const au = o.author ? [].concat(o.author).map(a => typeof a === 'string' ? a : a.name).filter(Boolean).join(', ') : '';
          d.yazar = d.yazar || decode(au);
          d.isbn = d.isbn || isbnIn(o.isbn || o.gtin13 || o.sku || '');
          d.sayfa = d.sayfa || parseInt(o.numberOfPages) || null;
          d.yayinevi = d.yayinevi || decode((o.publisher && (o.publisher.name || o.publisher)) || (o.brand && (o.brand.name || o.brand)) || '');
          const img = [].concat(o.image || [])[0]; d.kapak = d.kapak || (typeof img === 'string' ? img : (img && img.url) || '');
          d.aciklama = d.aciklama || decode(o.description || '').slice(0, 1200);
        }
      } catch (e) {}
    }
    // Open Graph
    const ogt = temizBaslik(meta(html, 'og:title'));
    if (!d.yazar && / - /.test(ogt)) { const parts = ogt.split(' - '); if (parts.length === 2 && parts[1].length < 50) d.yazar = parts[1].trim(); }
    d.baslik = d.baslik || ogt.split(' - ')[0];
    d.kapak = d.kapak || meta(html, 'og:image');
    d.aciklama = d.aciklama || meta(html, 'og:description').slice(0, 1200);
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); if (h1 && decode(h1[1]).length > 1) d.baslik = temizBaslik(h1[1]);
    // Yazar: başlığın hemen ardından gelen tek parçalı yazar bağlantısı (ör. <a href="/pierce-brown">Pierce Brown</a>)
    if (!d.yazar && h1) {
      const sonra = html.slice(h1.index, h1.index + 4000);
      for (const m of sonra.matchAll(/<a[^>]+href=["'](?:https?:\/\/[^"'\/]+)?\/((?:yazar\/)?[a-z0-9-]+)\/?["'][^>]*>([^<]{3,50})<\/a>/gi)) {
        const t = decode(m[2]);
        if (/^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.'\s-]{2,48}$/.test(t) && t.split(/\s+/).length <= 5 && !/yay[ıi]n|kitap|sepet|giriş|üye|kampanya|kategori/i.test(t)) { d.yazar = t; break; }
      }
    }
    // Ürün bilgi satırları (ISBN :, Sayfa Sayısı :, Yayınevi :, Yazar :)
    const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' | '));
    const lbl = (re) => { const m = text.match(re); return m ? m[1].replace(/\s*\|\s*/g, ' ').trim() : ''; };
    d.isbn = d.isbn || isbnIn(lbl(/(?:ISBN|Barkod)[\s|:]*([\d\s-]{13,20})/i));
    d.sayfa = d.sayfa || parseInt(lbl(/Sayfa Say[ıi]s[ıi][\s|:]*(\d{2,4})/i)) || null;
    d.yayinevi = d.yayinevi || lbl(/Yay[ıi]nevi[\s|:]*([^|:]{2,60}?)\s*\|/i);
    d.yazar = d.yazar || lbl(/Yazar(?:lar)?[\s|:]*([^|:]{2,60}?)\s*\|/i) || meta(html, 'author');
    d.yil = lbl(/(?:Bas[ıi]m Tarihi|Yay[ıi]n Tarihi|Bas[ıi]m Y[ıi]l[ıi])[\s|:]*[^|]*?((?:19|20)\d{2})/i);
    if (d.kapak && d.kapak.startsWith('//')) d.kapak = 'https:' + d.kapak;
    return d;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = String(req.query.q || '').slice(0, 120).trim();
  const isbn = String(req.query.isbn || '').replace(/[^0-9X]/gi, '');
  if (!q && !isbn) return res.status(400).json({ hata: 'q veya isbn gerekli', sonuclar: [] });
  const exa = process.env.EXA_API_KEY, brave = process.env.BRAVE_API_KEY;
  if (!exa && !brave) return res.status(501).json({ hata: 'EXA_API_KEY tanımlı değil', sonuclar: [] });

  const sorgu = isbn ? `ISBN ${isbn} kitap` : `${q} kitap`;
  let web = [];
  try { web = exa ? await exaAra(sorgu, exa) : await braveAra(sorgu, brave); }
  catch (e) {
    if (exa && brave) { try { web = await braveAra(sorgu, brave); } catch (e2) {} }
    if (!web.length) return res.status(502).json({ hata: String(e.message || e), sonuclar: [] });
  }

  const adaylar = [];
  for (const w of web) {
    let u; try { u = new URL(w.url); } catch (e) { continue; }
    const site = SITES.find(s => u.hostname === s.host || u.hostname.endsWith('.' + s.host));
    if (!site || !site.yol.test(u.pathname)) continue;
    adaylar.push({ w, site });
    if (adaylar.length >= 8) break;
  }

  const sonuclar = (await Promise.all(adaylar.map(async ({ w, site }, i) => {
    const m = metindenOku((w.description || '') + ' ' + (w.text || ''));
    let d = { baslik: temizBaslik(w.title), kapak: w.image || '', isbn: m.isbn || isbnIn(w.description), sayfa: m.sayfa,
      yayinevi: m.yayinevi, yazar: m.yazar || '', yil: m.yil, aciklama: '' };
    Object.keys(d).forEach(k => { if (!d[k]) delete d[k]; });
    const eksik = !d.kapak || !d.isbn || !d.sayfa || !d.yazar;
    if (site.oku && eksik && i < 4) { const p = await sayfaOku(w.url); if (p) d = { ...d, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) }; }
    // "Altın Oğul - Pierce Brown" biçimindeki başlıkları ayır
    if (!d.yazar && / - /.test(d.baslik)) { const [a, b] = d.baslik.split(' - '); d.baslik = a.trim(); d.yazar = b.trim(); }
    return { ...d, dil: 'tr', kaynak: site.ad, url: w.url };
  }))).filter(d => d.baslik && d.baslik.length > 1);

  let son = sonuclar;
  if (isbn) { const tam = sonuclar.filter(d => d.isbn === isbn); if (tam.length) son = tam; }
  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=604800');
  return res.status(200).json({ sonuclar: son.slice(0, 8) });
};
