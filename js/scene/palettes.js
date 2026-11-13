/* Colour scripts for the city. Each one is a complete lighting setup:
   sky, sun or moon, the four skyline depths, and the light that hits the hero. */
(function () {
  'use strict';
  const SMR = window.SMR;

  SMR.palettes = {
    dawn: {
      label: 'First light',
      sky: [
        [0.0, '#04060f'], [0.15, '#080e2c'], [0.32, '#161a54'], [0.46, '#3a1c66'], [0.575, '#7c1f5c'],
        [0.675, '#c7313f'], [0.755, '#f2622e'], [0.835, '#ffa53f'], [0.93, '#ffd27a'],
      ],
      stars: 0.85,
      orb: { kind: 'sun', core: '#fff7de', mid: '#ffdc8f', edge: '#ffae45', glow: '#ff7436', halo: '#ffc873' },
      rays: [255, 196, 120, 0.085],
      cloud: ['#47205f', '#ff8747'],
      far: ['#8b2f59', '#e4643f'],
      mid: ['#3f1b56', '#a03350'],
      near: ['#120d29', '#3a1842'],
      front: '#06050f',
      rim: '#ff9a4a',
      fill: '#3b6bff',
      haze: '#ff7a45',
      windows: ['#ffd27a', '#ffd27a', '#ffb45e', '#ffe9b8', '#9ccbff'],
      windowLit: 0.2,
      dust: '#ffdcaa',
      web: ['#fff3e2', '#ffb070'],
      ink: '#05060f',
    },

    dusk: {
      label: 'Last light',
      sky: [
        [0.0, '#07051a'], [0.16, '#150a3a'], [0.33, '#33125e'], [0.47, '#6a1873'], [0.585, '#b3246f'],
        [0.685, '#ea4a5a'], [0.765, '#ff8050'], [0.845, '#ffb85c'], [0.93, '#ffe08c'],
      ],
      stars: 0.55,
      orb: { kind: 'sun', core: '#fff3d0', mid: '#ffc978', edge: '#ff8a4c', glow: '#ff4f6a', halo: '#ffa07a' },
      rays: [255, 150, 130, 0.075],
      cloud: ['#5a1a6e', '#ff7a66'],
      far: ['#9a2a72', '#f06a55'],
      mid: ['#4a1763', '#b23466'],
      near: ['#170b2e', '#45164d'],
      front: '#080510',
      rim: '#ff7a5c',
      fill: '#6a4bff',
      haze: '#ff6a6a',
      windows: ['#ffd27a', '#ffc46a', '#ffe9b8', '#ffb45e', '#b6a6ff'],
      windowLit: 0.34,
      dust: '#ffc4b0',
      web: ['#ffeee6', '#ff9a86'],
      ink: '#07050f',
    },

    night: {
      label: 'Midnight',
      sky: [
        [0.0, '#02030a'], [0.2, '#050a1e'], [0.42, '#0a1638'], [0.6, '#122552'], [0.72, '#1c3a70'],
        [0.8, '#28508a'], [0.88, '#3a6ba0'], [0.95, '#4f86b4'],
      ],
      stars: 1,
      orb: { kind: 'moon', core: '#f6f9ff', mid: '#dde8fb', edge: '#b9cdf0', glow: '#5f8fe6', halo: '#a9c6ff' },
      rays: [150, 190, 255, 0.04],
      cloud: ['#0c1836', '#5f86c4'],
      far: ['#1d3a6c', '#3f6ea0'],
      mid: ['#11224a', '#294a80'],
      near: ['#080e22', '#152649'],
      front: '#03050c',
      rim: '#a9c8ff',
      fill: '#e5162d',
      haze: '#4f7fc0',
      windows: ['#ffd27a', '#ffd27a', '#ffc46a', '#ffe9b8', '#9ccbff', '#ff8f6a'],
      windowLit: 0.5,
      dust: '#cfe0ff',
      web: ['#eef5ff', '#9dc0ff'],
      ink: '#03050c',
    },
  };

  /** Which palette matches the player's own clock. */
  SMR.paletteForHour = function (hour) {
    if (hour >= 5 && hour < 12) return 'dawn';
    if (hour >= 12 && hour < 20) return 'dusk';
    return 'night';
  };
})();
