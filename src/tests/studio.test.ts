import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseCubeLUT, createIdentityLUT, createCinematicPresetLUT } from '../engine/lut-parser.js';
import { formatTimecode } from '../engine/video-controller.js';

describe('3D LUT (.cube) Parser & Presets', () => {
  it('should parse standard Adobe .cube string accurately', () => {
    const cubeSample = `
# Sample DJI DLog Cube LUT
TITLE "Test_DJI_DLog"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
    const lut = parseCubeLUT(cubeSample);
    expect(lut.title).toBe('Test_DJI_DLog');
    expect(lut.size).toBe(2);
    expect(lut.domainMin).toEqual([0.0, 0.0, 0.0]);
    expect(lut.domainMax).toEqual([1.0, 1.0, 1.0]);
    // 2x2x2 = 8 entries, 8 * 4 floats = 32 floats
    expect(lut.data.length).toBe(32);
    // First entry: (0, 0, 0, 1)
    expect(lut.data[0]).toBe(0.0);
    expect(lut.data[1]).toBe(0.0);
    expect(lut.data[2]).toBe(0.0);
    expect(lut.data[3]).toBe(1.0);
    // Last entry: (1, 1, 1, 1)
    expect(lut.data[28]).toBe(1.0);
    expect(lut.data[29]).toBe(1.0);
    expect(lut.data[30]).toBe(1.0);
    expect(lut.data[31]).toBe(1.0);
  });

  it('should throw for mismatched LUT data points', () => {
    const invalidCube = `
LUT_3D_SIZE 3
0.0 0.0 0.0
1.0 1.0 1.0
`;
    expect(() => parseCubeLUT(invalidCube)).toThrow(/mismatch/i);
  });

  it('should generate valid identity 3D LUT', () => {
    const identity = createIdentityLUT(4);
    expect(identity.size).toBe(4);
    expect(identity.data.length).toBe(4 * 4 * 4 * 4);
    // Corners
    expect(identity.data[0]).toBe(0.0); // (0,0,0)
    expect(identity.data[identity.data.length - 2]).toBe(1.0); // (1,1,1)
  });

  it('should generate valid cinematic film 3D LUT preset within [0, 1] bounds', () => {
    const cinematic = createCinematicPresetLUT(17);
    expect(cinematic.size).toBe(17);
    expect(cinematic.title).toContain('Cinematic');
    for (let i = 0; i < cinematic.data.length; i++) {
      expect(cinematic.data[i]).toBeGreaterThanOrEqual(0.0);
      expect(cinematic.data[i]).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('Video Timecode & Frame Calculation', () => {
  it('should format seconds into SMPTE timecode string correctly', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00.00');
    expect(formatTimecode(1.5, 30)).toBe('00:00:01.15');
    expect(formatTimecode(65.2, 30)).toBe('00:01:05.06');
    expect(formatTimecode(3661.0, 30)).toBe('01:01:01.00');
  });

  it('should handle edge cases like negative or NaN time', () => {
    expect(formatTimecode(-5, 30)).toBe('00:00:00.00');
    expect(formatTimecode(NaN, 30)).toBe('00:00:00.00');
  });
});

describe('Spherical Horizon Leveling Quaternion Math', () => {
  it('should yield identity quaternion when pitch=0, roll=0, yaw=0', () => {
    const pitchRad = THREE.MathUtils.degToRad(0);
    const rollRad = THREE.MathUtils.degToRad(0);
    const yawRad = THREE.MathUtils.degToRad(0);

    const qHeading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
    const qLevel = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, 0, rollRad, 'YXZ'));
    const combined = qHeading.multiply(qLevel);

    expect(combined.x).toBeCloseTo(0, 5);
    expect(combined.y).toBeCloseTo(0, 5);
    expect(combined.z).toBeCloseTo(0, 5);
    expect(combined.w).toBeCloseTo(1, 5);
  });

  it('should compute valid rotation vectors for gimbal roll and pitch corrections', () => {
    // 15 degrees roll test
    const rollDeg = 15;
    const rollRad = THREE.MathUtils.degToRad(rollDeg);
    const qLevel = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rollRad, 'YXZ'));

    const testVec = new THREE.Vector3(1, 0, 0);
    testVec.applyQuaternion(qLevel);

    // Vector rotated around Z axis should maintain length 1 and have non-zero Y
    expect(testVec.length()).toBeCloseTo(1.0, 5);
    expect(testVec.y).toBeCloseTo(Math.sin(rollRad), 4);
    expect(testVec.x).toBeCloseTo(Math.cos(rollRad), 4);
  });
});
