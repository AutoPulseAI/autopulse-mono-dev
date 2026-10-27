// A vehicle photo the CRM serves itself (app/api/media/vehicle) is only served when its bytes are a real image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageType } from './app/lib/imageType.js';

test('the image type comes from the bytes, not the host', () => {
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(imageType(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(imageType(Buffer.from('<html>not found</html>')), null);
  assert.equal(imageType(Buffer.alloc(0)), null);
});
