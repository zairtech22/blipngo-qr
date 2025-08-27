/* eslint-disable */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const QRCode = require('qrcode');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// --- init ---
const prisma = new PrismaClient();
const app = express();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// --- middleware & view engine ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- helpers ---
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}
async function makeQrPng(url, outPath) {
  const buf = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 2, width: 800 });
  await fs.promises.writeFile(outPath, buf);
}
async function ensureQrs(biz) {
  const qrDir = path.join(__dirname, 'public', 'qrs');
  if (!fs.existsSync(qrDir)) await fs.promises.mkdir(qrDir, { recursive: true });

  if (biz.instagramUrl) {
    const scanUrl = `${BASE_URL}/r/${biz.slug}/instagram`;
    const out = path.join(qrDir, `${biz.slug}-instagram.png`);
    await makeQrPng(scanUrl, out);
    await prisma.business.update({ where: { id: biz.id }, data: { qrInstagram: '/public/qrs/' + `${biz.slug}-instagram.png` } });
  } else if (biz.qrInstagram) {
    try { await fs.promises.unlink(path.join(__dirname, biz.qrInstagram.replace('/public/', 'public/'))); } catch {}
    await prisma.business.update({ where: { id: biz.id }, data: { qrInstagram: null } });
  }

  if (biz.tiktokUrl) {
    const scanUrl = `${BASE_URL}/r/${biz.slug}/tiktok`;
    const out = path.join(qrDir, `${biz.slug}-tiktok.png`);
    await makeQrPng(scanUrl, out);
    await prisma.business.update({ where: { id: biz.id }, data: { qrTiktok: '/public/qrs/' + `${biz.slug}-tiktok.png` } });
  } else if (biz.qrTiktok) {
    try { await fs.promises.unlink(path.join(__dirname, biz.qrTiktok.replace('/public/', 'public/'))); } catch {}
    await prisma.business.update({ where: { id: biz.id }, data: { qrTiktok: null } });
  }

  if (biz.youtubeUrl) {
    const scanUrl = `${BASE_URL}/r/${biz.slug}/youtube`;
    const out = path.join(qrDir, `${biz.slug}-youtube.png`);
    await makeQrPng(scanUrl, out);
    await prisma.business.update({ where: { id: biz.id }, data: { qrYoutube: '/public/qrs/' + `${biz.slug}-youtube.png` } });
  } else if (biz.qrYoutube) {
    try { await fs.promises.unlink(path.join(__dirname, biz.qrYoutube.replace('/public/', 'public/'))); } catch {}
    await prisma.business.update({ where: { id: biz.id }, data: { qrYoutube: null } });
  }
}

// --- routes ---

// ---------- ROUTES ----------

// Home (renders views/index.ejs)
app.get('/', async (req, res) => {
  const businesses = await prisma.business.findMany({ orderBy: { createdAt: 'desc' } });
  res.render('index', { businesses });
});

// Create business
app.post('/business', async (req, res) => {
  try {
    const { name, slug: customSlug, logoUrl,
            themeHex, themeBgHex, themeBgHex2,
            publicTitle, publicSubtitle, publicFooter, ctaLabel,
            instagramUrl, tiktokUrl, youtubeUrl } = req.body;

    const slug = (customSlug && customSlug.trim().length)
      ? customSlug.trim().toLowerCase()
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const biz = await prisma.business.create({
      data: {
        name, slug, logoUrl,
        themeHex, themeBgHex, themeBgHex2,
        publicTitle, publicSubtitle, publicFooter, ctaLabel,
        instagramUrl, tiktokUrl, youtubeUrl
      }
    });

    await ensureQrs(biz);
    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error creating business: ' + (e?.message || e));
  }
});

// Admin page
app.get('/business/:slug', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');
  res.render('business', { biz });
});

// Update platform URL (weekly links)
app.post('/business/:slug/update', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');

  const { platform, newUrl } = req.body;
  const platKey = (platform || '').toLowerCase();
  if (!['instagram','tiktok','youtube'].includes(platKey)) return res.status(400).send('Invalid platform');

  const current = biz[platKey + 'Url'];
  const data = {}; data[platKey + 'Url'] = newUrl || null;

  await prisma.$transaction([
    prisma.redirectHistory.create({
      data: { businessId: biz.id, platform: platKey.toUpperCase(), fromUrl: current, toUrl: newUrl || '' }
    }),
    prisma.business.update({ where: { id: biz.id }, data })
  ]);

  const updated = await prisma.business.findUnique({ where: { id: biz.id } });
  await ensureQrs(updated);

  res.redirect(`/business/${biz.slug}`);
});

// Save theme / public copy
app.post('/business/:slug/theme', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    const { themeHex, themeBgHex, themeBgHex2, publicTitle, publicSubtitle, publicFooter, ctaLabel, showLogo } = req.body;
    const updated = await prisma.business.update({
      where: { id: biz.id },
      data: {
        themeHex: themeHex || null,
        themeBgHex: themeBgHex || null,
        themeBgHex2: themeBgHex2 || null,
        publicTitle: publicTitle || null,
        publicSubtitle: publicSubtitle || null,
        publicFooter: publicFooter || null,
        ctaLabel: ctaLabel || null,
        showLogo: !!showLogo
      }
    });
    res.redirect(`/business/${updated.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Theme save failed: ' + (e?.message || e));
  }
});

// Regenerate QR images for one business
app.post('/business/:slug/regen', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');
    await ensureQrs(biz);
    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to regenerate QR: ' + (e?.message || e));
  }
});

// Regenerate all businesses
app.post('/admin/regen-all', async (req, res) => {
  try {
    const list = await prisma.business.findMany();
    for (const biz of list) await ensureQrs(biz);
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to regenerate all QRs: ' + (e?.message || e));
  }
});

// Toggle platform on/off
app.post('/business/:slug/toggle', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    const { platform, enabled } = req.body;
    if (!['instagram','tiktok','youtube'].includes(platform)) return res.status(400).send('Invalid platform');

    const urlKey = platform + 'Url';
    const qrKey  = 'qr' + platform[0].toUpperCase() + platform.slice(1);
    const isEnabled = enabled === 'on';

    if (!isEnabled) {
      // disable: remove URL + QR file
      const rel = biz[qrKey];
      if (rel && rel.startsWith('/public/')) {
        try { await fs.promises.unlink(path.join(__dirname, rel.replace('/public/', 'public/'))); } catch {}
      }
      const data = {}; data[urlKey] = null; data[qrKey] = null;
      await prisma.business.update({ where: { id: biz.id }, data });
      await prisma.redirectHistory.create({
        data: { businessId: biz.id, platform: platform.toUpperCase(), fromUrl: biz[urlKey], toUrl: '' }
      });
    } else {
      // enable: needs URL
      const { newUrl } = req.body;
      const toUrl = (newUrl && newUrl.trim()) ? newUrl.trim() : biz[urlKey];
      if (!toUrl) return res.status(400).send('Provide a URL to enable this platform.');
      const updated = await prisma.business.update({ where: { id: biz.id }, data: { [urlKey]: toUrl } });
      await ensureQrs(updated);
      await prisma.redirectHistory.create({
        data: { businessId: biz.id, platform: platform.toUpperCase(), fromUrl: biz[urlKey], toUrl }
      });
    }

    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Toggle failed: ' + (e?.message || e));
  }
});

// Delete business
app.post('/business/:slug/delete', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    for (const rel of [biz.qrInstagram, biz.qrTiktok, biz.qrYoutube].filter(Boolean)) {
      if (rel.startsWith('/public/')) {
        try { await fs.promises.unlink(path.join(__dirname, rel.replace('/public/', 'public/'))); } catch {}
      }
    }

    await prisma.redirectHistory.deleteMany({ where: { businessId: biz.id } });
    await prisma.scanEvent.deleteMany({ where: { businessId: biz.id } });
    await prisma.business.delete({ where: { id: biz.id } });

    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Delete failed: ' + (e?.message || e));
  }
});

// Public printable page (views/publicpage.ejs)
app.get('/p/:slug', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');
  res.render('publicpage', { biz });
});

// Redirect: QR target
app.get('/r/:slug/:platform', async (req, res) => {
  const plat = (req.params.platform || '').toLowerCase();
  if (!['instagram','tiktok','youtube'].includes(plat)) return res.status(400).send('Invalid platform');
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');
  const target = biz[plat + 'Url'];
  if (!target) return res.redirect(`/p/${biz.slug}`);

  // light analytics
  const ua = req.headers['user-agent'] || null;
  const ipRaw = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ip = ipRaw.split(',')[0].trim();
  const ipHash = ip ? require('crypto').createHash('sha256').update(ip).digest('hex') : null;
  const referer = req.headers['referer'] || null;

  await prisma.scanEvent.create({
    data: { businessId: biz.id, platform: plat.toUpperCase(), userAgent: ua, ipHash, referer }
  });

  res.redirect(target);
});

// Simple analytics JSON
app.get('/business/:slug/analytics.json', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).json({ error: 'Not found' });
  const rows = await prisma.scanEvent.groupBy({
    by: ['platform'],
    _count: { _all: true },
    where: { businessId: biz.id }
  });
  res.json({ business: biz.slug, counts: rows.map(r => ({ platform: r.platform, count: r._count._all })) });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
