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

// Вінь'єтка (раніше — окремий BitmapMask-спрайт, що конфліктував з цим post-pipeline
// через спільні framebuffer'и → на проді зникала). Тепер усе в одному шейдері.
uniform float uVigStr;     // сила (0 = вимкнено)
uniform vec3  uVigCol;     // колір вінь'єтки (multiply), 0..1
uniform float uVigTop;     // floorFrac: частка висоти екрана, де починається підлога
uniform float uVigHasMask; // 1 = темнити лише по масці площини-карти, 0 = по всьому кадру
uniform sampler2D uMaskSampler;
uniform vec4  uMaskXf;     // x=scaleX y=offX z=scaleY w=offY (екранний UV → UV маски)
uniform float uMaskFlipV;  // 1 = перевернути V маски

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

  // Вінь'єтка — еліпс-градієнт у смузі підлоги (та сама математика, що в редакторі),
  // замаскований по площині-карти (щоб не темнити фон/небо).
  // sy: 0 = верх кадру, 1 = низ. У post-shader outTexCoord.y=0 — це НИЗ, тож інвертуємо.
  float sy = 1.0 - outTexCoord.y;
  if (uVigStr > 0.001 && sy > uVigTop) {
    float ry = (1.0 - uVigTop) * 0.5;
    float cyN = uVigTop + ry;
    float dx = (outTexCoord.x - 0.5) / 0.5;
    float dy = (sy - cyN) / ry;
    float d = sqrt(dx * dx + dy * dy);
    // canvas-градієнт: 0 до 0.45 радіуса, далі лінійно до uVigStr на краю
    float a = clamp((d - 0.45) / 0.55, 0.0, 1.0) * uVigStr;
    float mAlpha = 1.0;
    if (uVigHasMask > 0.5) {
      float mu = outTexCoord.x * uMaskXf.x + uMaskXf.y;
      float mvRaw = sy * uMaskXf.z + uMaskXf.w;
      float mv = mix(mvRaw, 1.0 - mvRaw, uMaskFlipV);
      mAlpha = (mu < 0.0 || mu > 1.0 || mv < 0.0 || mv > 1.0)
        ? 0.0 : texture2D(uMaskSampler, vec2(mu, mv)).a;
    }
    a *= mAlpha;
    col = col * (1.0 - a + a * uVigCol); // multiply-blend із кольором вінь'єтки
  }

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

  // Вінь'єтка
  vigStr = 0;
  vigCol: [number, number, number] = [0, 0, 0];
  vigTop = 0.5;
  vigHasMask = false;
  maskXf: [number, number, number, number] = [1, 0, 1, 0];
  maskFlipV = false;
  // WebGLTextureWrapper текстури-маски (_vigMask); ставить GameScene після buildVignetteMask
  maskTex: { webGLTexture: WebGLTexture } | null = null;

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
    // Вінь'єтка
    this.set1f('uVigStr', this.vigStr);
    this.set3f('uVigCol', this.vigCol[0], this.vigCol[1], this.vigCol[2]);
    this.set1f('uVigTop', this.vigTop);
    const useMask = this.vigHasMask && !!this.maskTex;
    this.set1f('uVigHasMask', useMask ? 1 : 0);
    this.set4f('uMaskXf', this.maskXf[0], this.maskXf[1], this.maskXf[2], this.maskXf[3]);
    this.set1f('uMaskFlipV', this.maskFlipV ? 1 : 0);
    if (useMask) this.set1i('uMaskSampler', 1);
  }

  // Прив'язуємо текстуру-маску до юніта 1 перед малюванням (bindAndDraw чіпає лише юніт 0,
  // тож наша прив'язка зберігається). uMainSampler (юніт 0) ставить сам bindAndDraw.
  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget): void {
    if (this.vigStr > 0.001 && this.vigHasMask && this.maskTex) {
      this.bindTexture(this.maskTex as unknown as Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper, 1);
    }
    this.bindAndDraw(renderTarget);
  }
}
