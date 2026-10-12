// Phase H slice 1: the owner guide and the links into it.
// Checks the real content and the real helpers. No network, no keys, no database, no browser storage.
import { describe, expect, it } from 'vitest';
import { BRAIN_SLOTS } from '../../supabase/functions/_shared/brains';
import { DOOR_IDS, DOORS } from '../../supabase/functions/_shared/doorRegistry';
import {
  GUIDE_ANCHOR_IDS,
  GUIDE_BACK_DEFAULT,
  GUIDE_LINK_LABEL,
  GUIDE_MISSING_SHORT,
  GUIDE_PATH,
  GUIDE_SHORTS,
  guideBackTarget,
  guideHref,
  guideShort,
  hasGuideSection,
  safeGuideBack,
} from '../admin/lib/guide';
import { GUIDE_SECTIONS, guideGroups, guideSection } from '../admin/lib/guideSections';
import { hashTargetId, restoreHashFocus } from '../admin/lib/hashFocus';

// The anchors the in-place help on each page uses. Every one of these must have a real section on the guide page.
const GUIDE_SECTION_IDS = GUIDE_SECTIONS.map((section) => section.id);
const ANCHORS_WITH_A_SHORT = GUIDE_ANCHOR_IDS;

const IN_PLACE_ANCHORS: Record<string, readonly string[]> = {
  keys: ['keys', 'save-key', 'test-key', 'delete-key', 'vapid'],
  brains: BRAIN_SLOTS.map((slot) => slot.id),
  connections: ['connections', ...DOOR_IDS.map((id) => `door-${id}`)],
  minds: ['takeover', 'kill'],
};

const ENGINE_WORD = /vault|\brpc\b|postgres|postgresql|\boauth\b|\bjwt\b|\brls\b|seq_scan|supabase/i;
const PLACE_WORD = /nigeria|lagos|\bwat\b|naira|abuja|africa\/lagos/i;

describe('guide content: one section per owner action, in plain English', () => {
  it('has a section for every anchor the pages link to', () => {
    for (const [page, anchors] of Object.entries(IN_PLACE_ANCHORS)) {
      for (const anchor of anchors) {
        expect(hasGuideSection(anchor), `${page} links to #${anchor}`).toBe(true);
      }
    }
  });

  it('has the anchors this phase promises: gemini, vapid and takeover', () => {
    for (const anchor of ['gemini', 'vapid', 'takeover']) {
      expect(ANCHORS_WITH_A_SHORT, anchor).toContain(anchor);
      expect(GUIDE_SECTION_IDS, anchor).toContain(anchor);
    }
  });

  it('the line shown in place and the section underneath it agree, both ways', () => {
    for (const anchor of ANCHORS_WITH_A_SHORT) {
      const section = guideSection(anchor);
      expect(section, anchor).not.toBeNull();
      expect(section!.short, anchor).toBe(GUIDE_SHORTS[anchor]);
    }
    for (const section of GUIDE_SECTIONS) {
      expect(GUIDE_SHORTS[section.id], section.id).toBeDefined();
      expect(section.short, section.id).toBe(GUIDE_SHORTS[section.id]);
    }
    expect(new Set(GUIDE_SECTION_IDS).size).toBe(GUIDE_SECTION_IDS.length);
    expect(GUIDE_SECTION_IDS.length).toBe(ANCHORS_WITH_A_SHORT.length);
  });

  it('covers every brain and every place Buddy can post to', () => {
    for (const slot of BRAIN_SLOTS) expect(GUIDE_SECTION_IDS).toContain(slot.id);
    for (const id of DOOR_IDS) expect(GUIDE_SECTION_IDS).toContain(`door-${id}`);
  });

  it('every id is unique, and every section has a title, a short line and at least two steps', () => {
    expect(new Set(GUIDE_SECTION_IDS).size).toBe(GUIDE_SECTION_IDS.length);
    for (const section of GUIDE_SECTIONS) {
      expect(section.title.trim().length, section.id).toBeGreaterThan(0);
      expect(section.short.trim().length, section.id).toBeGreaterThan(20);
      expect(section.steps.length, section.id).toBeGreaterThanOrEqual(2);
      for (const step of section.steps) expect(step.trim().length, section.id).toBeGreaterThan(10);
    }
  });

  it('English only: no engine words, no em dash, and no country, city or currency names', () => {
    for (const section of GUIDE_SECTIONS) {
      const text = [section.title, section.short, ...section.steps].join(' ');
      expect(text, section.id).not.toContain('\u2014');
      expect(text, section.id).not.toMatch(ENGINE_WORD);
      expect(text, section.id).not.toMatch(PLACE_WORD);
    }
    expect(GUIDE_LINK_LABEL).not.toContain('\u2014');
    expect(GUIDE_LINK_LABEL).not.toMatch(ENGINE_WORD);
  });

  it('the Gemini section is the owner wording, word for word', () => {
    expect(guideShort('gemini')).toBe(
      'Get a free key at aistudio.google.com. Paste once. It is never shown again. Test does not publish.',
    );
    expect(guideSection('gemini')?.steps.join(' ')).toContain('aistudio.google.com');
  });

  it('the phone alert section points at Keys, the phone and Register this device', () => {
    const vapid = guideSection('vapid');
    expect(vapid).not.toBeNull();
    expect(vapid!.short).toMatch(/Register this device/);
    expect(vapid!.steps.join(' ')).toMatch(/\/admin\/settings/);
    expect(vapid!.steps.join(' ')).toMatch(/phone/i);
  });

  it('Takeover says it is off by default, and Kill explains the three choices', () => {
    expect(guideShort('takeover')).toMatch(/off by default/i);
    expect(guideSection('kill')!.steps.join(' ')).toMatch(/All/);
  });

  it('the two skipped brains say they are skipped instead of asking for a key', () => {
    for (const id of ['cerebras', 'deepseek']) {
      const section = guideSection(id)!;
      expect(section.short).toMatch(/skip/i);
      expect(section.short).toMatch(/do not need/i);
      expect(section.steps.join(' ')).toMatch(/box empty/i);
    }
  });

  it('every place section names the details it asks for', () => {
    for (const id of DOOR_IDS) {
      const section = guideSection(`door-${id}`)!;
      for (const field of DOORS[id].fields) expect(section.steps.join(' '), id).toContain(field.label);
    }
  });

  it('the guide is grouped, in reading order, with every section in exactly one group', () => {
    const groups = guideGroups();
    expect(groups.map((group) => group.group)).toEqual([
      'Start here', 'Brains', 'Phone alerts', 'Minds', 'Connections',
    ]);
    expect(groups.flatMap((group) => group.sections)).toHaveLength(GUIDE_SECTIONS.length);
  });

  it('an unknown anchor gets a plain fallback line instead of an empty one', () => {
    expect(guideShort('not-a-real-anchor')).toBe(GUIDE_MISSING_SHORT);
    expect(guideSection('not-a-real-anchor')).toBeNull();
  });
});

describe('the link into the guide and the way back', () => {
  it('the link carries the anchor and the page and field it came from', () => {
    const href = guideHref('gemini', '/admin/automation/brains#brain-key-gemini_api_key');
    expect(href.startsWith(`${GUIDE_PATH}?back=`)).toBe(true);
    expect(href.endsWith('#gemini')).toBe(true);
    expect(decodeURIComponent(href)).toContain('/admin/automation/brains#brain-key-gemini_api_key');
  });

  it('an unknown anchor still opens the guide, without a broken fragment', () => {
    expect(guideHref('not-a-real-anchor', null)).toBe(GUIDE_PATH);
    expect(guideHref('vapid', null)).toBe(`${GUIDE_PATH}#vapid`);
  });

  it('only a path inside the admin area can be a way back', () => {
    expect(safeGuideBack('/admin/automation/keys#automation-key-gemini_api_key'))
      .toBe('/admin/automation/keys#automation-key-gemini_api_key');
    expect(safeGuideBack('/admin/ai/connections')).toBe('/admin/ai/connections');
    for (const bad of [
      'https://example.com/admin', '//example.com/admin', 'javascript:alert(1)', '/account',
      '/admin/../etc', '/admin/keys with a space', 'admin/keys', '', '   ', null, undefined,
      '/admin/keys\u0000', '/admin/keys\\x', `/admin/${'a'.repeat(400)}`,
    ]) {
      expect(safeGuideBack(bad as string | null | undefined)).toBeNull();
    }
  });

  it('reads the way back from the address, and falls back to Keys when there is none or it is unsafe', () => {
    expect(guideBackTarget('?back=%2Fadmin%2Fautomation%2Fkeys%23vapid-subject'))
      .toBe('/admin/automation/keys#vapid-subject');
    expect(guideBackTarget('?back=javascript%3Aalert%281%29')).toBe(GUIDE_BACK_DEFAULT);
    expect(guideBackTarget('?back=https%3A%2F%2Fexample.com')).toBe(GUIDE_BACK_DEFAULT);
    expect(guideBackTarget('')).toBe(GUIDE_BACK_DEFAULT);
    expect(GUIDE_BACK_DEFAULT.startsWith('/admin/')).toBe(true);
  });
});

describe('coming back to the same field', () => {
  it('accepts a plain element id and refuses anything else', () => {
    expect(hashTargetId('#automation-key-gemini_api_key')).toBe('automation-key-gemini_api_key');
    expect(hashTargetId('#brain-key-gemini_api_key')).toBe('brain-key-gemini_api_key');
    for (const bad of ['', '#', '#1starts-with-a-number', '#has space', '#..parent', '#<script>']) {
      expect(hashTargetId(bad)).toBeNull();
    }
  });

  it('finds and focuses a field that is already on the page', () => {
    document.body.innerHTML = '<input id="vapid-subject" />';
    const cancel = restoreHashFocus('#vapid-subject', document, 1, 10);
    expect(document.activeElement?.id).toBe('vapid-subject');
    cancel();
    expect(restoreHashFocus('#not-there', document, 1, 10)).toBeTypeOf('function');
  });

  it('keeps looking for a field that is drawn after the page reads its data', async () => {
    document.body.innerHTML = '';
    const cancel = restoreHashFocus('#late-field', document, 10, 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const input = document.createElement('input');
    input.id = 'late-field';
    document.body.appendChild(input);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(document.activeElement).toBe(input);
    cancel();
    expect(input.value).toBe('');
  });

  it('stops quietly when the field never appears, and a cancel really stops it', async () => {
    document.body.innerHTML = '';
    const cancel = restoreHashFocus('#never-drawn', document, 3, 5);
    await new Promise((resolve) => setTimeout(resolve, 40));
    cancel();
    const late = document.createElement('input');
    late.id = 'never-drawn';
    document.body.appendChild(late);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(document.activeElement).not.toBe(late);
  });
});
