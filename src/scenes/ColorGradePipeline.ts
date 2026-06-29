import Phaser from 'phaser';

// Повторює кольоровий баланс редактора (src/level/editor.ts, блок «Кольоровий баланс»)
// один-в-один, але у WebGL — щоб ГРА виглядала як прев'ю студії.
// Порядок як у CSS-фільтрі редактора: brightness → contrast(+cavity) → saturate → hue,
// потім попіксельні тіні/середні/світлини з luma-маскою, наприкінці — ч/б (ультрапохмурий).
const FRAG = `
#define SHADER_NAME COLOR_GRADE_FS
precision mediump float;
uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uHue;        // радіани
uniform vec3  uShadowCol;
uniform vec3  uMidCol;
uniform vec3  uHighCol;
uniform float uShadowStr;
uniform float uMidStr;
uniform float uHighStr;
uniform float uGray;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

vec3 hueRotate(vec3 c0, float c, float s) {
  float m00 = 0.299 + 0.701*c + 0.168*s;
  float m01 = 0.587 - 0.587*c + 0.330*s;
  float m02 = 0.114 - 0.114*c - 0.497*s;
  float m10 = 0.299 - 0.299*c - 0.328*s;
  float m11 = 0.587 + 0.413*c + 0.035*s;
  float m12 = 0.114 - 0.114*c + 0.292*s;
  float m20 = 0.299 - 0.300*c + 1.250*s;
  float m21 = 0.587 - 0.588*c - 1.050*s;
  float m22 = 0.114 + 0.886*c - 0.203*s;
  return vec3(
    dot(c0, vec3(m00, m01, m02)),
    dot(c0, vec3(m10, m11, m12)),
    dot(c0, vec3(m20, m21, m22))
  );
}

void main(void) {
  vec4 tex = texture2D(uMainSampler, outTexCoord);
  vec3 col = tex.rgb;

  // brightness / contrast / saturation / hue (як CSS filter редактора)
  col *= uBrightness;
  col = (col - 0.5) * uContrast + 0.5;
  float l1 = dot(col, LUMA);
  col = mix(vec3(l1), col, uSaturation);
  if (abs(uHue) > 0.0008) col = hueRotate(col, cos(uHue), sin(uHue));
  col = clamp(col, 0.0, 1.0);

  // Тіні / середні / світлини — luma-маска (та сама математика, що в редакторі)
  float luma = dot(col, LUMA);
  col = mix(col, uShadowCol, max(0.0, 1.0 - luma * 2.0) * uShadowStr);
  col = mix(col, uMidCol,    max(0.0, 1.0 - abs(luma - 0.5) * 4.0) * uMidStr);
  col = mix(col, uHighCol,   max(0.0, (luma - 0.35) / 0.65) * uHighStr);

  // Ч/б (тривожність = 100)
  if (uGray > 0.001) col = mix(col, vec3(dot(col, LUMA)), uGray);

  gl_FragColor = vec4(col, tex.a);
}
`;

export class ColorGradePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  brightness = 1;
  contrast = 1;
  saturation = 1;
  hue = 0; // радіани
  shadowCol: [number, number, number] = [0, 0, 0.2];
  midCol: [number, number, number] = [0, 0.2, 0];
  highCol: [number, number, number] = [1, 1, 0.93];
  shadowStr = 0;
  midStr = 0;
  highStr = 0;
  gray = 0;

  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAG });
  }

  // hex '#rrggbb' → нормалізований 0..1 vec3
  static parse(hex: string): [number, number, number] {
    const h = hex.replace('#', '').padStart(6, '0');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  onPreRender(): void {
    this.set1f('uBrightness', this.brightness);
    this.set1f('uContrast', this.contrast);
    this.set1f('uSaturation', this.saturation);
    this.set1f('uHue', this.hue);
    this.set3f('uShadowCol', this.shadowCol[0], this.shadowCol[1], this.shadowCol[2]);
    this.set3f('uMidCol', this.midCol[0], this.midCol[1], this.midCol[2]);
    this.set3f('uHighCol', this.highCol[0], this.highCol[1], this.highCol[2]);
    this.set1f('uShadowStr', this.shadowStr);
    this.set1f('uMidStr', this.midStr);
    this.set1f('uHighStr', this.highStr);
    this.set1f('uGray', this.gray);
  }
}
