// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import b4a from 'b4a';

/**
 * Simple encoding/decoding for messages
 * Uses JSON for simplicity, but could be replaced with more efficient encoding
 */

export function encode(message) {
  const json = JSON.stringify(message);
  return b4a.from(json, 'utf-8');
}

export function decode(buffer) {
  const json = b4a.toString(buffer, 'utf-8');
  return JSON.parse(json);
}
