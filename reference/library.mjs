// Shared inputs for the generated, script-free template library and its freshness test.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ROOT } from '../server/config.mjs';

export const LIBRARY_INPUTS = [
  'core/brand.mjs', 'core/composed.mjs', 'composer/templates.mjs',
  'composer/scene-layouts.mjs', 'composer/page.mjs', 'composer/render.mjs',
  'reference/library.mjs', 'tools/build-reference.mjs', 'package-lock.json',
  'assets/logos/hitlights-logo-white.png', 'assets/logos/hitlights-logo-black.png',
  'assets/logos/hitlights-mark.png',
];

export function libraryFingerprint() {
  const hash = crypto.createHash('sha256');
  for (const file of LIBRARY_INPUTS) hash.update(file + '\0').update(fs.readFileSync(`${ROOT}/${file}`));
  return hash.digest('hex');
}

// Schematic placeholders, created for this public reference. No customer or Drive images.
export const ROOM = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
<defs><linearGradient id="wall" x2="1" y2="1"><stop stop-color="#7c6b64"/><stop offset="1" stop-color="#3c3434"/></linearGradient><linearGradient id="floor" x2="0" y2="1"><stop stop-color="#8d7160"/><stop offset="1" stop-color="#403737"/></linearGradient></defs>
<path fill="url(#wall)" d="M0 0h1200v880H0z"/><path fill="url(#floor)" d="M0 880h1200v320H0z"/>
<path d="M0 110h1200M0 130h1200" stroke="#f6cf8e" stroke-width="8" opacity=".8"/>
<path d="M70 215h330v510H70z" fill="#342c2e"/><path d="M85 370h300M85 535h300M85 700h300" stroke="#b18a64" stroke-width="13"/>
<path d="M85 355h300M85 520h300M85 685h300" stroke="#ffe0a0" stroke-width="5"/>
<path d="M113 275h45v72h-45zM165 288h22v59h-22zM205 256h35v91h-35zM120 430h100v80H120zM270 450h64v60h-64z" fill="#a79785"/>
<path d="M715 220h385v460H715z" fill="#a2b4b5"/><path d="M715 220h385v460H715zM900 220v460M715 450h385" fill="none" stroke="#322f34" stroke-width="18"/>
<path d="M460 720q0-35 35-35h520q35 0 35 35v170H460z" fill="#b7a99d"/><rect x="430" y="790" width="650" height="155" rx="30" fill="#c7bcb1"/><path d="M490 945v35M1020 945v35" stroke="#2a2629" stroke-width="20"/>
<rect x="505" y="725" width="110" height="95" rx="16" fill="#887665"/><rect x="860" y="725" width="130" height="95" rx="16" fill="#ddd2c0"/>
<ellipse cx="700" cy="1060" rx="350" ry="85" fill="#ad9f8c" opacity=".7"/><ellipse cx="675" cy="1020" rx="165" ry="45" fill="#493c36"/>
</svg>`;
export const PRODUCT = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<rect x="22" y="22" width="356" height="556" rx="36" fill="#fbf6ee" fill-opacity=".95" stroke="#b7a3cf" stroke-width="5" stroke-dasharray="12 10"/>
<path d="M140 150h120v100H140zM140 150l60-25 60 25M200 125v25" fill="none" stroke="#675185" stroke-width="8" stroke-linejoin="round"/>
<text x="200" y="355" text-anchor="middle" fill="#523875" font-family="Arial,sans-serif" font-size="34" font-weight="bold">YOUR PRODUCT</text>
<text x="200" y="400" text-anchor="middle" fill="#675185" font-family="Arial,sans-serif" font-size="25">transparent cutout</text></svg>`;
