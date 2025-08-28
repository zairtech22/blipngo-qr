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

// expose BASE_URL to all views
app.locals.BASE_URL = BASE_URL;

// --- middleware & view engine ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- ROUTES ----------

// Home
app.get('/', async (req, res) => {
  const businesses = await prisma.business.findMany({ orderBy: { createdAt: 'desc' } });
  res.render('index', { businesses, BASE_URL });
});

// Create business
app.post('/business', async (req, res) => {
  try {
    const { name, slug: customSlug, logoUrl,
            themeHex, themeBgHex, themeBgHex2,
            publicTitle, publicSubtitle, publicFooter, ctaLabel,
            instagramUrl, tiktokUrl, youtubeUrl, showLogo, qrLayout } = req.body;

    const slug = (customSlug && customSlug.trim().length)
      ? customSlug.trim().toLowerCase()
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const biz = await prisma.business.create({
      data: {
        name, slug, logoUrl,
        themeHex, themeBgHex, themeBgHex2,
        publicTitle, publicSubtitle, publicFooter, ctaLabel,
        instagramUrl, tiktokUrl, youtubeUrl,
        showLogo: !!showLogo,
        qrLayout: (qrLayout === 'horizontal' ? 'horizontal' : 'vertical')
      }
    });

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
  res.render('business', { biz, BASE_URL });
});

// Update platform URL (weekly links) - single input per platform
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

  res.redirect(`/business/${biz.slug}`);
});

// Save theme / public copy (+ qrLayout)
app.post('/business/:slug/theme', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    const { themeHex, themeBgHex, themeBgHex2, publicTitle, publicSubtitle, publicFooter, ctaLabel, showLogo, qrLayout } = req.body;
    await prisma.business.update({
      where: { id: biz.id },
      data: {
        themeHex: themeHex || null,
        themeBgHex: themeBgHex || null,
        themeBgHex2: themeBgHex2 || null,
        publicTitle: publicTitle || null,
        publicSubtitle: publicSubtitle || null,
        publicFooter: publicFooter || null,
        ctaLabel: ctaLabel || null,
        showLogo: !!showLogo,
        qrLayout: (qrLayout === 'horizontal' ? 'horizontal' : 'vertical')
      }
    });
    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Theme save failed: ' + (e?.message || e));
  }
});

// No-op: kept for UI parity
app.post('/business/:slug/regen', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');
    // Dynamic QR: nothing to regenerate.
    res.redirect(`/business/${biz.slug}`);
  } catch (e) { console.error(e); res.status(500).send('Failed: ' + (e?.message || e)); }
});

// No-op: regen all
app.post('/admin/regen-all', async (req, res) => {
  try { res.redirect('/'); } catch (e) { console.error(e); res.status(500).send('Failed: ' + (e?.message || e)); }
});

// Toggle platform on/off (keep QR static)
app.post('/business/:slug/toggle', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    const { platform, enabled } = req.body;
    if (!['instagram','tiktok','youtube'].includes(platform)) return res.status(400).send('Invalid platform');

    const urlKey = platform + 'Url';
    const isEnabled = enabled === 'on';

    if (!isEnabled) {
      await prisma.business.update({ where: { id: biz.id }, data: { [urlKey]: null } });
      await prisma.redirectHistory.create({
        data: { businessId: biz.id, platform: platform.toUpperCase(), fromUrl: biz[urlKey], toUrl: '' }
      });
    } else {
      const { newUrl } = req.body;
      const toUrl = (newUrl && newUrl.trim()) ? newUrl.trim() : biz[urlKey];
      if (!toUrl) return res.status(400).send('Provide a URL to enable this platform.');
      await prisma.business.update({ where: { id: biz.id }, data: { [urlKey]: toUrl } });
      await prisma.redirectHistory.create({
        data: { businessId: biz.id, platform: platform.toUpperCase(), fromUrl: biz[urlKey], toUrl }
      });
    }

    res.redirect(`/business/${biz.slug}`);
  } catch (e) { console.error(e); res.status(500).send('Toggle failed: ' + (e?.message || e)); }
});

// Delete business
app.post('/business/:slug/delete', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    await prisma.redirectHistory.deleteMany({ where: { businessId: biz.id } });
    await prisma.scanEvent.deleteMany({ where: { businessId: biz.id } });
    await prisma.business.delete({ where: { id: biz.id } });

    res.redirect('/');
  } catch (e) { console.error(e); res.status(500).send('Delete failed: ' + (e?.message || e)); }
});

// Public printable / display page
app.get('/p/:slug', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');

  const kiosk = req.query.kiosk === '1';
  const printMode = req.query.print === '1';
  res.render('publicpage', { biz, kiosk, printMode, BASE_URL });
});

// Redirect (scans)
app.get('/r/:slug/:platform', async (req, res) => {
  const plat = (req.params.platform || '').toLowerCase();
  const valid = ['instagram','tiktok','youtube'];
  if (!valid.includes(plat)) return res.status(400).send('Invalid platform');
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');

  const target = biz[plat + 'Url'];
  if (!target) return res.redirect(`/p/${biz.slug}`);

  const ua = req.headers['user-agent'] || null;
  const ipRaw = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ip = ipRaw.split(',')[0].trim();
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex') : null;
  const referer = req.headers['referer'] || null;

  await prisma.scanEvent.create({
    data: { businessId: biz.id, platform: plat.toUpperCase(), userAgent: ua, ipHash, referer }
  });

  return res.redirect(target);
});

// Analytics JSON
app.get('/business/:slug/analytics.json', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).json({ error: 'Not found' });
  const rows = await prisma.scanEvent.groupBy({
    by: ['platform'], _count: { _all: true }, where: { businessId: biz.id }
  });
  res.json({ business: biz.slug, counts: rows.map(r => ({ platform: r.platform, count: r._count._all })) });
});

// Dynamic QR image (no files, stable forever)
const QR_OPTS = { errorCorrectionLevel: 'M', margin: 2, width: 800 };
app.get('/qr/:slug/:platform.png', async (req, res) => {
  const { slug, platform } = req.params;
  const valid = ['instagram', 'tiktok', 'youtube'];
  if (!valid.includes(platform)) return res.status(400).send('Invalid platform');
  const biz = await prisma.business.findUnique({ where: { slug } });
  if (!biz) return res.status(404).send('Not found');

  const urlToEncode = `${BASE_URL}/r/${biz.slug}/${platform}`;
  try {
    const buf = await QRCode.toBuffer(urlToEncode, QR_OPTS);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).send('QR error');
  }
});

// --- start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${BASE_URL}`);
});
