import { describe, expect, it } from 'vitest';
import { HOWTO_DOORS, HOWTO_REPLIES, howToDoor, howToReply } from '../../supabase/functions/_shared/buddyHowTo';
import { routeMessage } from '../../supabase/functions/_shared/buddyRouter';

describe('Buddy answers how to connect the six new doors', () => {
  it('a how-to question names one door, and that door is answered', () => {
    expect(howToDoor('How do I connect YouTube?')).toBe('youtube');
    expect(howToDoor('set up Vimeo for me')).toBe('vimeo');
    expect(howToDoor('how do i hook up my podcast')).toBe('podcast');
    expect(howToDoor('steps for WordPress.com')).toBe('wordpress_com');
    expect(howToDoor('how do I use Pixelfed?')).toBe('pixelfed');
    expect(howToDoor('how do I connect Medium')).toBe('medium');
  });

  it('an order with no how-to word is not a question, so it is not answered as one', () => {
    expect(howToDoor('Post to YouTube')).toBeNull();
    expect(howToDoor('Run the products')).toBeNull();
  });

  it('a message naming two doors, or a door that is not one of the six, is left to the other rules', () => {
    expect(howToDoor('how do I connect YouTube and Vimeo')).toBeNull();
    expect(howToDoor('how do I connect Telegram')).toBeNull();
    expect(howToDoor('how do I connect Instagram')).toBeNull();
  });

  it('the router returns a how-to route for a question about one door, and not for a mind question', () => {
    expect(routeMessage('How do I connect YouTube?', null)).toEqual({ kind: 'how_to', door: 'youtube' });
    expect(routeMessage('How is the Executioner doing?', null).kind).toBe('mind_log');
  });

  it('every door has a reply, and each reply points to Connections', () => {
    for (const door of HOWTO_DOORS) {
      expect(HOWTO_REPLIES[door], door).toMatch(/Connections/);
      expect(howToReply(door)).toBe(HOWTO_REPLIES[door]);
    }
  });

  it('replies are short, plain, and have no em dash, country, currency or secret request', () => {
    for (const door of HOWTO_DOORS) {
      const reply = howToReply(door);
      expect(reply.length, door).toBeLessThan(600);
      expect(reply, door).not.toMatch(/—|–/);
      expect(reply, door).not.toMatch(/Nigeria|Naira|Lagos|WAT|Abuja|USD|\$/);
      expect(reply, door).not.toMatch(/paste your (password|secret|key) here/i);
    }
  });

  it('the Medium reply says the token is only one the owner already has', () => {
    expect(howToReply('medium')).toMatch(/no longer issues new tokens/);
  });

  it('the podcast reply names the feed address, and says the owner submits it', () => {
    const reply = howToReply('podcast');
    expect(reply).toContain('/podcast.xml');
    expect(reply).toMatch(/You submit that feed yourself/);
  });

  it('the YouTube and Vimeo replies say a video is sent only when a real one exists', () => {
    expect(howToReply('youtube')).toMatch(/only when a real video was made/);
    expect(howToReply('vimeo')).toMatch(/only when a real video was made/);
  });
});
