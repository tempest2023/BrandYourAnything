import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
const baseUrl = process.env.SURFACE_E2E_URL;

test('surface creation: presets, region selection, drag, missing spots and saved draft', { skip: !baseUrl, timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const draft = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('brand-anything-sell-draft')));
  try {
    await page.goto(baseUrl + '/sell');
    for (const [machine, teslaModel, count] of [['tesla', 'Model 3', 5], ['tesla', 'Cybertruck', 5], ['yacht', 'Model 3', 6], ['jet', 'Model 3', 6]]) {
      await page.evaluate(({ machine, teslaModel }) => sessionStorage.setItem('brand-anything-sell-draft', JSON.stringify({ step: 3, furthestStep: 4, machine, teslaModel, modelMode: 'preset', ownership: 'own', assetName: 'Surface test' })), { machine, teslaModel });
      await page.reload();
      await page.getByRole('button', { name: 'Reset recommended layout' }).waitFor();
      await page.waitForFunction(count => JSON.parse(sessionStorage.getItem('brand-anything-sell-draft'))?.surfaceSpots?.length === count, count);
      await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
      assert.equal((await draft()).layoutCount, count);
      assert.equal(new Set((await draft()).surfaceSpots.map(s => JSON.stringify(s.position))).size, count);
    }
    // A seventh jet spot has no fabricated/default coordinate.
    await page.getByRole('button', { name: 'Add one spot' }).click();
    await page.getByRole('button', { name: 'Place every spot to continue' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Place every spot to continue' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Reset recommended layout' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
    // Leave only one placement, then choose a genuinely different region.
    const countInput = page.getByRole('spinbutton');
    await countInput.fill('1'); await countInput.blur();
    const region = page.getByRole('combobox');
    await region.selectOption('Starboard tail');
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('brand-anything-sell-draft')).surfaceSpotPricing[0].region === 'Starboard tail');
    const placed = (await draft()).surfaceSpots[0];
    assert.ok(placed.position[0] > 1);
    assert.ok(placed.normal[2] < -0.9);
    const marker = page.getByRole('button', { name: 'Spot 1, available', exact: true });
    await marker.waitFor({ state: 'visible' });
    await marker.scrollIntoViewIfNeeded();
    let box = await marker.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 12, box.y + box.height / 2 + 8, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(before => JSON.stringify(JSON.parse(sessionStorage.getItem('brand-anything-sell-draft')).surfaceSpots[0].position) !== JSON.stringify(before), placed.position);
    const moved = (await draft()).surfaceSpots;
    // Invalid drops retain the previous placement.
    box = await marker.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(2, 2, { steps: 6 }); await page.mouse.up();
    await page.getByText('Drop the spot on the model. Its previous position was kept.').waitFor();
    assert.deepEqual((await draft()).surfaceSpots, moved);
    await page.getByRole('button', { name: 'Undo move', exact: true }).click();
    await page.getByText('Last move undone.', { exact: true }).waitFor();
    assert.deepEqual((await draft()).surfaceSpots[0].position, placed.position);
    await page.reload();
    await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
    assert.deepEqual((await draft()).surfaceSpots[0].position, placed.position);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
