"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.linearBlur = exports.linearBlurShader = void 0;
const html_in_canvas_presentation_1 = require("../html-in-canvas-presentation");
const upload_element_image_1 = require("./upload-element-image");
const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
// Adapted from https://gl-transitions.com/editor/LinearBlur
// Author: gre · License: MIT
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform sampler2D u_next;
uniform float u_time;
uniform float u_intensity;

in vec2 v_uv;
out vec4 outColor;

const int PASSES = 20;

vec4 transition(vec2 uv, float progress) {
	vec4 c1 = vec4(0.0);
	vec4 c2 = vec4(0.0);

	float disp = u_intensity * (0.5 - distance(0.5, progress));
	for (int xi = 0; xi < PASSES; xi++) {
		float x = float(xi) / float(PASSES) - 0.5;
		for (int yi = 0; yi < PASSES; yi++) {
			float y = float(yi) / float(PASSES) - 0.5;
			vec2 v = vec2(x, y);
			c1 += texture(u_prev, uv + disp * v);
			c2 += texture(u_next, uv + disp * v);
		}
	}

	c1 /= float(PASSES * PASSES);
	c2 /= float(PASSES * PASSES);
	return mix(c1, c2, progress);
}

void main() {
	float progress = 1.0 - u_time;
	outColor = transition(v_uv, progress);
}`;
const compileShader = (gl, source, type) => {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Failed to compile shader: ${log}`);
    }
    return shader;
};
const createProgram = (gl) => {
    const program = gl.createProgram();
    if (!program) {
        throw new Error('Failed to create WebGL program');
    }
    const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = compileShader(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Failed to link program: ${log}`);
    }
    return program;
};
const createTexture = (gl) => {
    const tex = gl.createTexture();
    if (!tex) {
        throw new Error('Failed to create texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return tex;
};
const linearBlurShader = (canvas) => {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true });
    if (!gl) {
        throw new Error('Failed to create WebGL2 context');
    }
    const program = createProgram(gl);
    const prevTex = createTexture(gl);
    const nextTex = createTexture(gl);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uPrev = gl.getUniformLocation(program, 'u_prev');
    const uNext = gl.getUniformLocation(program, 'u_next');
    const uIntensity = gl.getUniformLocation(program, 'u_intensity');
    const cleanup = () => {
        gl.deleteProgram(program);
        gl.deleteTexture(prevTex);
        gl.deleteTexture(nextTex);
    };
    const clear = () => {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    };
    const draw = ({ prevImage, nextImage, width, height, time, passedProps, }) => {
        const { intensity = 0.1 } = passedProps;
        if (!prevImage && !nextImage) {
            return;
        }
        if (prevImage && (prevImage.width === 0 || prevImage.height === 0)) {
            return;
        }
        if (nextImage && (nextImage.width === 0 || nextImage.height === 0)) {
            return;
        }
        // At time=0 the shader outputs nextImage. At time=1 the shader outputs prevImage.
        const effectiveTime = !prevImage ? 0 : !nextImage ? 1 : time;
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        if (prevImage) {
            (0, upload_element_image_1.uploadElementImage)(gl, prevImage);
        }
        gl.uniform1i(uPrev, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, nextTex);
        if (nextImage) {
            (0, upload_element_image_1.uploadElementImage)(gl, nextImage);
        }
        gl.uniform1i(uNext, 1);
        gl.uniform1f(uTime, effectiveTime);
        gl.uniform1f(uIntensity, intensity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    return {
        clear,
        cleanup,
        draw,
    };
};
exports.linearBlurShader = linearBlurShader;
exports.linearBlur = (0, html_in_canvas_presentation_1.makeHtmlInCanvasPresentation)(exports.linearBlurShader);
