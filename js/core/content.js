/* Everything the menu says and offers lives here, so it is easy to edit. */
(function () {
  'use strict';
  const SMR = window.SMR;

  SMR.content = {
    version: 'Menu build 0.1',

    suits: [
      { id: 'rebirth', name: 'Rebirth', line: 'Stitched back together on a kitchen table at 3 a.m. It holds.',
        mask: '#c4122b', body: '#17275f', web: '#09090f', emblem: '#f4f7fc', lens: '#f4f7fc', frame: '#08080e', thread: '#e9dcc6', seam: true,
        accent: '#e5162d', accent2: '#2f6bff' },
      { id: 'classic', name: 'Classic', line: 'Red, blue, and no good excuses.',
        mask: '#e3141c', body: '#1f52e0', web: '#0b0b10', emblem: '#0b0b10', lens: '#ffffff', frame: '#0b0b10',
        accent: '#f3202a', accent2: '#3b78ff' },
      { id: 'nightshift', name: 'Night Shift', line: 'For the hours the city pretends to sleep.',
        mask: '#191a22', body: '#0d0e14', web: '#c4122b', emblem: '#c4122b', lens: '#f4f7fc', frame: '#c4122b',
        accent: '#e5162d', accent2: '#8a8fa6' },
      { id: 'firstlight', name: 'First Light', line: 'The colour of the sky ten minutes before anyone else is awake.',
        mask: '#f2ece0', body: '#c8451f', web: '#b8431f', emblem: '#c8451f', lens: '#ffe9b8', frame: '#2a1408',
        accent: '#ff7a36', accent2: '#ffd27a', locked: true, unlock: 'Finish the story' },
      { id: 'frontpage', name: 'Front Page', line: 'Black and white and read all over.',
        mask: '#d9d9d9', body: '#2b2b2e', web: '#111114', emblem: '#111114', lens: '#ffffff', frame: '#111114',
        accent: '#e8e8e8', accent2: '#9a9a9a', locked: true, unlock: 'Take 20 photos for the Bugle' },
    ],

    difficulties: [
      { id: 'easy', name: 'Easy Swing', line: 'Here for the story. Enemies pull their punches and the ground is forgiving.' },
      { id: 'crawler', name: 'Wall-Crawler', line: 'The way it is meant to be played. Miss a swing and you will feel it.' },
      { id: 'menace', name: 'Menace', line: 'The city hits back, hard. Every fight is one mistake from over.' },
      { id: 'nonet', name: 'No Safety Net', line: 'One life. No checkpoints. Nobody is coming to catch you.' },
    ],

    headlines: [
      'Web-head returns? Midtown commuters report a red blur at dawn',
      'Mayor has "no comment" on masked vigilante sightings',
      'Bugle poll: menace or miracle? 62% say both',
      'Scaffolding collapse on 9th Avenue averted by "a lot of string"',
      'Clear skies, light crosswinds over the East River: ideal swinging weather',
      'Pizza arrives in a record six minutes; customer suspicious',
      'Rent in Queens up 9%. Heroes not exempt',
      'Lost: one left web-shooter. Sentimental value. Reward: gratitude',
    ],

    tips: [
      'Let go at the bottom of the arc for speed, at the top for height.',
      'Buildings are taller than they look. Commit to the swing.',
      'The best time to let go is right after it feels too late.',
    ],

    controls: [
      ['Move / look', 'W A S D / mouse', 'Left stick / right stick'],
      ['Walk', 'Hold Left Alt', 'Hold L3'],
      ['Swing (in the air) / sprint', 'Hold Left Shift', 'Hold RT'],
      ['Jump (hold for height) / web-zip in the air', 'Space', 'A'],
      ['Zip to a point', 'C', 'RB'],
      ['Perch / dive', 'X', 'LB'],
      ['Air trick', 'T', 'R3'],
      ['Melee', 'Left click', 'X'],
      ['Web-strike', 'F', 'Y'],
      ['Dodge', 'Left Ctrl or mouse 4', 'B'],
      ['Aim / yank', 'Hold right mouse / Q', 'Hold LT / RB'],
      ['Heal / finisher', '1 / 2', 'D-pad up / down'],
      ['Gadget', 'E', 'D-pad left'],
      ['Map / scan', 'Tab / V', 'View / D-pad right'],
      ['Pause / photo mode / contrast', 'Esc / P / G', 'Start'],
    ],

    credits: [
      ['Spider-Man: Rebirth', ['An unofficial fan game']],
      ['Created by', ['Your name here']],
      ['Hero 3D model', ['Your name here']],
      ['City', ['Built in code', 'Rendered with three.js']],
      ['Lettering', ['Spinneret, drawn for this game']],
      ['Sound', ['Synthesised live in the browser']],
      ['Spider-Man created by', ['Stan Lee and Steve Ditko']],
      ['Legal', ['Spider-Man and all related characters', 'are trademarks of Marvel.', 'This is a non-commercial fan project,', 'not affiliated with or endorsed by', 'Marvel or Sony.']],
      ['Thanks for playing', ['Go get them, tiger.']],
    ],
  };
})();
