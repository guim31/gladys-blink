import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetImage } from '@gladysassistant/integration-sdk';
import {
  CAMERA_IMAGE_MAX_BYTES,
  WIDGET_IMAGE_MAX_BYTES,
  cameraImage,
  fitJpeg,
  isJpeg,
} from '../src/images.js';
import { makeJpeg } from './helpers/fakeBlink.js';

test('a small JPEG is kept as it is', () => {
  const small = makeJpeg();
  assert.equal(fitJpeg(small, CAMERA_IMAGE_MAX_BYTES), small);
});

test('a large JPEG is halved until it fits, and stays a JPEG', () => {
  const large = makeJpeg(800, 450, 100);
  assert.ok(large.length > CAMERA_IMAGE_MAX_BYTES);
  const fitted = fitJpeg(large, CAMERA_IMAGE_MAX_BYTES);
  assert.ok(isJpeg(fitted));
  assert.ok(fitted.length <= CAMERA_IMAGE_MAX_BYTES);
  assert.ok(cameraImage(fitted).length <= 150 * 1024, 'the whole string fits the camera channel');
  assert.deepEqual(
    validateWidgetImage(fitJpeg(large, WIDGET_IMAGE_MAX_BYTES).toString('base64')),
    [],
  );
});

test('what is not a JPEG is refused', () => {
  assert.equal(fitJpeg(Buffer.from('<html>Unauthorized</html>'), CAMERA_IMAGE_MAX_BYTES), null);
  assert.equal(fitJpeg(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), 2), null);
  assert.equal(fitJpeg(null, CAMERA_IMAGE_MAX_BYTES), null);
});
