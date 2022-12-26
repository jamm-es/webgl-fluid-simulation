//
// shaders
//

// vertex shader, shared by all programs
const vertexShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 a_position;
out vec2 uv;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    uv = (a_position + 1.0) / 2.0;
}
`;

// add velocity based on mouse movement
const mouseVelocityFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
uniform vec2 u_pixel;
uniform sampler2D u_velocity;
uniform vec2 u_prev_mouse_pos;
uniform vec2 u_curr_mouse_pos;
out vec2 new_velocity;
#define RADIUS 50.0

void main() {
    vec2 cur_loc = gl_FragCoord.xy;
    new_velocity = texture(u_velocity, uv).rg;
    
    // no movement
    if(u_prev_mouse_pos == u_curr_mouse_pos) {
        return;
    }
    
    // calculate dist as dist from cur_loc to the line segment representing mouse motion
    // formula baesd on https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
    float l2 = dot(u_prev_mouse_pos-u_curr_mouse_pos, u_prev_mouse_pos-u_curr_mouse_pos);
    float t = clamp(dot(cur_loc-u_prev_mouse_pos, u_curr_mouse_pos-u_prev_mouse_pos) / l2, 0.0, 1.0);
    vec2 proj = u_prev_mouse_pos + t*(u_curr_mouse_pos-u_prev_mouse_pos);
    float dist = distance(cur_loc, proj);
    if(dist <= RADIUS) {
        vec2 mouse_force = u_curr_mouse_pos - u_prev_mouse_pos;
        new_velocity += mouse_force * 0.05 * (RADIUS-dist) / RADIUS;
    }
}
`

// advect velocity
const advectVelocityFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
uniform vec2 u_pixel;
uniform sampler2D u_velocity;
uniform sampler2D u_barrier;
out vec2 new_velocity;
#define DELTA_T 1.0/60.0

void main() {
    new_velocity = texture(u_velocity, uv - DELTA_T*texture(u_velocity, uv).rg*u_pixel*1000.0).rg * (1.0-2.0*texture(u_barrier, vec2(uv.x, 1.0-uv.y)).a);
}
`;

// calculate divergence of velocity
const divergenceFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
uniform vec2 u_pixel;
uniform sampler2D u_velocity;
out float divergence;

void main() {
    float x0 = texture(u_velocity, uv-vec2(u_pixel.x,0)).r;
    float x1 = texture(u_velocity, uv+vec2(u_pixel.x,0)).r;
    float y0 = texture(u_velocity, uv-vec2(0,u_pixel.y)).g;
    float y1 = texture(u_velocity, uv+vec2(0,u_pixel.y)).g;
    divergence = -0.5*(x1-x0+y1-y0);
}
`;

// use jacobi method to calculate pressure
const jacobiPressureFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
uniform vec2 u_pixel;
uniform sampler2D u_divergence;
uniform sampler2D u_pressure;
out float new_pressure;

void main() {
    float p_north = texture(u_pressure, uv+vec2(0, u_pixel.y)).r;
    float p_south = texture(u_pressure, uv-vec2(0, u_pixel.y)).r;
    float p_east = texture(u_pressure, uv+vec2(u_pixel.x, 0)).r;
    float p_west = texture(u_pressure, uv-vec2(u_pixel.x, 0)).r;
    float d = texture(u_divergence, uv).r;
    new_pressure = (p_north + p_south + p_east + p_west + d) / 4.0;
}
`;

// subtract pressure from velocity
const gradientPressureFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
uniform vec2 u_pixel;
uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform sampler2D u_barrier;
out vec2 new_velocity;

void main() {
    float p_north = texture(u_pressure, uv+vec2(0, u_pixel.y)).r;
    float p_south = texture(u_pressure, uv-vec2(0, u_pixel.y)).r;
    float p_east = texture(u_pressure, uv+vec2(u_pixel.x, 0)).r;
    float p_west = texture(u_pressure, uv-vec2(u_pixel.x, 0)).r;
    new_velocity = (texture(u_velocity, uv).rg - 0.5*vec2(p_east-p_west, p_north-p_south)) * (1.0-2.0*texture(u_barrier, vec2(uv.x, 1.0-uv.y)).a);
    if(texture(u_barrier, vec2(uv.x, 1.0-uv.y)).a > 0.5) {
        new_velocity = vec2(0.0, 0.0);
    }
}
`;

// fragment shader
const drawingFragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
uniform vec2 u_pixel;
uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform sampler2D u_barrier;
out vec4 color;
#define PI 3.14159265

void main() {
    // calculate hsl
    vec2 cur_velocity = texture(u_velocity, uv).rg;
    float h;
    if(cur_velocity.x == 0.0) {
        if(cur_velocity.y > 0.0) {
            h = PI*0.5;
        }
        else {
            h = PI*1.5;
        }
    }
    else {
        h = mod(atan(cur_velocity.y, cur_velocity.x), 2.0*PI);
    }
    h *= 180.0/PI;
    float s = 1.0;
    float l = texture(u_pressure, uv).r * (1.0 - texture(u_barrier, vec2(uv.x, 1.0-uv.y)).a);
    float c = (1.0-abs(2.0*l-1.0))*s;
    float x = c*(1.0-abs(mod(h/60.0, 2.0)-1.0));
    float m = l-c/2.0;
    float r_prime, g_prime, b_prime;
    if(h < 60.0) {
        r_prime = c;
        g_prime = x; 
        b_prime = 0.0;
    }
    else if(h < 120.0) {
        r_prime = x;
        g_prime = c; 
        b_prime = 0.0;
    }
    else if(h < 180.0) {
        r_prime = 0.0;
        g_prime = c; 
        b_prime = x;
    }
    else if(h < 240.0) {
        r_prime = 0.0;
        g_prime = x;
        b_prime = c;
    }
    else if(h < 300.0) {
        r_prime = x; 
        g_prime = 0.0; 
        b_prime = c;
    }
    else {
        r_prime = c; 
        g_prime = 0.0; 
        b_prime = x;
    }
    vec3 rgb = (vec3(r_prime, g_prime, b_prime) + m) + texture(u_velocity, uv).rgb; 
    color = vec4(rgb, 1.0);
}
`;


//
// webgl utility functions
//

// make shader from shader source, a string, and shader type, either gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
function makeShader(gl, shaderSource, shaderType) {
  const shader = gl.createShader(shaderType);
  gl.shaderSource(shader, shaderSource);
  gl.compileShader(shader);

  // shader is ok
  if(gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  // shader compile error
  console.log(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
}

// makes program from a vertex shader and a fragment shader
function makeProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  // program is ok
  if(gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }

  // program linking error
  console.log(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
}

// make a data texture with enough pixels to cover the canvas width and height
function makeTexture(gl, canvas, textureIndex, internalFormat, format, type, dataPerPixel, dataSource) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0+textureIndex);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if(dataSource === undefined) {
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, canvas.width, canvas.height, 0, format, type, new Float32Array(canvas.width*canvas.height*dataPerPixel));
  }
  else {
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, canvas.width, canvas.height, 0, format, type, dataSource);
  }
  return texture;
}


//
// main program
//

// updated by ui controls
let simScale = 1;
let presetWalls = 'hello';
// let isSimMode = true;
let curAnimationFrame = -1;

// track mouse
let mousePos = { x: -1, y: -1 };
let canvasHeight = 0;
let isMouseDown = false;
document.onmousemove = e => {
  mousePos = { x: e.clientX*simScale, y: canvasHeight-e.clientY*simScale };
}
window.onresize = () => {
  cancelAnimationFrame(curAnimationFrame);
  reset(true);
}
// document.onmouseup = () => {
//   isMouseDown = false;
// }
// document.onmousedown = () => {
//   isMouseDown = true;
// }

function init(redraw=false) {
  // draw text and use it as a pseudo alpha mask - needs to be in a block so the 2d context is released
  const maskCanvas = document.getElementById('mask-canvas');
  maskCanvas.width = maskCanvas.clientWidth * simScale;
  maskCanvas.height = maskCanvas.clientHeight * simScale;
  canvasHeight = maskCanvas.height;

  if(redraw) {
    const ctx = maskCanvas.getContext('2d');
    ctx.fontStyle = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
    ctx.fontHeight = '100pt';
    ctx.font = '500 100px system-ui';
    ctx.fillStyle = '#000000';
    ctx.strokeRect(0, 0, maskCanvas.width, maskCanvas.height);
    switch(presetWalls) {
      case 'hello':
        const centralText = 'Hello!';
        const textDimensions = ctx.measureText(centralText);
        ctx.fillText(centralText, maskCanvas.width / 2 - textDimensions.width / 2, maskCanvas.height / 2 + 100 / 2);
        break;
      case 'empty':
        break;
      case 'circle':
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(maskCanvas.width/2, maskCanvas.height/2, 150, 0, Math.PI*2);
        ctx.stroke();
        break;
    }
  }

  // webgl context setup
  const canvas = document.getElementById('canvas');
  canvas.style.display = 'block';
  const gl = canvas.getContext('webgl2');
  gl.getExtension('EXT_color_buffer_float'); // required to use gl.RED and gl.RG in framebuffer
  canvas.width = canvas.clientWidth * simScale;
  canvas.height = canvas.clientHeight * simScale;
  const pixel = new Float32Array([1.0/canvas.width, 1.0/canvas.height]);

  // create shaders
  const vertexShader = makeShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
  const mouseVelocityFragmentShader = makeShader(gl, mouseVelocityFragmentShaderSource, gl.FRAGMENT_SHADER);
  const advectVelocityFragmentShader = makeShader(gl, advectVelocityFragmentShaderSource, gl.FRAGMENT_SHADER);
  const divergenceFragmentShader = makeShader(gl, divergenceFragmentShaderSource, gl.FRAGMENT_SHADER);
  const jacobiPressureFragmentShader = makeShader(gl, jacobiPressureFragmentShaderSource, gl.FRAGMENT_SHADER);
  const gradientPressureFragmentShader = makeShader(gl, gradientPressureFragmentShaderSource, gl.FRAGMENT_SHADER);
  const drawingFragmentShader = makeShader(gl, drawingFragmentShaderSource, gl.FRAGMENT_SHADER);

  // positions of a quad to fill full screen, needed so that shader will go through whole screen
  const positions = [
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1
  ];

  // add positions to each program
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // create programs - each is a self-calling function that returns a draw call, which may accept texture indices
  const mouseVelocity = (() => {
    const program = makeProgram(gl, vertexShader, mouseVelocityFragmentShader);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const pixelLocation = gl.getUniformLocation(program, 'u_pixel');
    const velocityLocation = gl.getUniformLocation(program, 'u_velocity');
    const prevMousePositionLocation = gl.getUniformLocation(program, 'u_prev_mouse_pos');
    const currMousePositionLocation = gl.getUniformLocation(program, 'u_curr_mouse_pos');

    return (frontVelocityIndex, prevMousePos, currMousePos) => {
      gl.useProgram(program);
      gl.uniform2fv(pixelLocation, pixel);
      gl.uniform1i(velocityLocation, frontVelocityIndex);
      gl.uniform2f(prevMousePositionLocation, prevMousePos.x, prevMousePos.y);

      // if prevMousePos is still the unset default, feed same positions for prev and curr so no forces are applied
      if(prevMousePos.x === -1) {
        gl.uniform2f(currMousePositionLocation, prevMousePos.x, prevMousePos.y);
      }
      else {
        gl.uniform2f(currMousePositionLocation, currMousePos.x, currMousePos.y);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  })();

  const advectVelocity = (() => {
    const program = makeProgram(gl, vertexShader, advectVelocityFragmentShader);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const pixelLocation = gl.getUniformLocation(program, 'u_pixel');
    const velocityLocation = gl.getUniformLocation(program, 'u_velocity');
    const barrierLocation = gl.getUniformLocation(program, 'u_barrier');

    return (frontVelocityIndex, barrierIndex) => {
      gl.useProgram(program);
      gl.uniform2fv(pixelLocation, pixel);
      gl.uniform1i(velocityLocation, frontVelocityIndex);
      gl.uniform1i(barrierLocation, barrierIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
  })();

  const divergence = (() => {
    const program = makeProgram(gl, vertexShader, divergenceFragmentShader);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const pixelLocation = gl.getUniformLocation(program, 'u_pixel');
    const velocityLocation = gl.getUniformLocation(program, 'u_velocity');

    return (currentVelocityIndex) => {
      gl.useProgram(program);
      gl.uniform2fv(pixelLocation, pixel);
      gl.uniform1i(velocityLocation, currentVelocityIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  })();

  const jacobiPressure = (() => {
    const program = makeProgram(gl, vertexShader, jacobiPressureFragmentShader);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const pixelLocation = gl.getUniformLocation(program, 'u_pixel');
    const divergenceLocation = gl.getUniformLocation(program, 'u_divergence');
    const pressureLocation = gl.getUniformLocation(program, 'u_pressure');

    return (divergenceIndex, frontPressureIndex) => {
      gl.useProgram(program);
      gl.uniform2fv(pixelLocation, pixel);
      gl.uniform1i(divergenceLocation, divergenceIndex);
      gl.uniform1i(pressureLocation, frontPressureIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  })();

  const gradientPressure = (() => {
    const program = makeProgram(gl, vertexShader, gradientPressureFragmentShader);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const pixelLocation = gl.getUniformLocation(program, 'u_pixel');
    const velocityLocation = gl.getUniformLocation(program, 'u_velocity');
    const pressureLocation = gl.getUniformLocation(program, 'u_pressure');
    const barrierLocation = gl.getUniformLocation(program, 'u_barrier');

    return (currentVelocityIndex, currentPressureIndex, barrierIndex) => {
      gl.useProgram(program);
      gl.uniform2fv(pixelLocation, pixel);
      gl.uniform1i(velocityLocation, currentVelocityIndex);
      gl.uniform1i(pressureLocation, currentPressureIndex);
      gl.uniform1i(barrierLocation, barrierIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  })();

  const drawing = (() => {
    const program = makeProgram(gl, vertexShader, drawingFragmentShader);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const pixelLocation = gl.getUniformLocation(program, 'u_pixel');
    const velocityLocation = gl.getUniformLocation(program, 'u_velocity');
    const pressureLocation = gl.getUniformLocation(program, 'u_pressure');
    const barrierLocation = gl.getUniformLocation(program, 'u_barrier');

    return (frontVelocityIndex, frontPressureIndex, barrierIndex) => {
      gl.useProgram(program);
      gl.uniform2fv(pixelLocation, pixel);
      gl.uniform1i(velocityLocation, frontVelocityIndex);
      gl.uniform1i(pressureLocation, frontPressureIndex);
      gl.uniform1i(barrierLocation, barrierIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  })();

  // texture to store fluid velocity vector field - swaps between front and back, with front being input and back being output
  const velocityTexture0 = makeTexture(gl, canvas, 0, gl.RG32F, gl.RG, gl.FLOAT, 2);
  const velocityTexture1 = makeTexture(gl, canvas, 1, gl.RG32F, gl.RG, gl.FLOAT, 2);
  let frontVelocityIndex = 0;
  let backVelocityIndex = 1;
  const velocityFramebuffer0 = gl.createFramebuffer(); // should be framebuffer when we want to draw to texture 0
  gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFramebuffer0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, velocityTexture0, 0);
  const velocityFramebuffer1 = gl.createFramebuffer(); // should be framebuffer when we want to draw to texture 1
  gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFramebuffer1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, velocityTexture1, 0);

  // swaps front and back textures, ensures we are drawing to the back buffer
  function swapVelocity() {
    if(frontVelocityIndex === 0) {
      frontVelocityIndex = 1;
      backVelocityIndex = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFramebuffer0);
    }
    else {
      frontVelocityIndex = 0;
      backVelocityIndex = 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocityFramebuffer1);
    }
  }

  // textures to store fluid pressure, front initialized to index 0, back initialized to index 1
  const pressureTexture2 = makeTexture(gl, canvas, 2, gl.R32F, gl.RED, gl.FLOAT, 1);
  const pressureTexture3 = makeTexture(gl, canvas, 3, gl.R32F, gl.RED, gl.FLOAT, 1);
  let frontPressureIndex = 2;
  let backPressureIndex = 3;
  const pressureFramebuffer2 = gl.createFramebuffer(); // should be framebuffer when we want to draw to texture 0
  gl.bindFramebuffer(gl.FRAMEBUFFER, pressureFramebuffer2);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pressureTexture2, 0);
  const pressureFramebuffer3 = gl.createFramebuffer(); // should be framebuffer when we want to draw to texture 1
  gl.bindFramebuffer(gl.FRAMEBUFFER, pressureFramebuffer3);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pressureTexture3, 0);

  // swaps front and back textures, ensures we are drawing to the back buffer
  function swapPressure() {
    if(frontPressureIndex === 2) {
      frontPressureIndex = 3;
      backPressureIndex = 2;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pressureFramebuffer2);
    }
    else {
      frontPressureIndex = 2;
      backPressureIndex = 3;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pressureFramebuffer3);
    }
  }

  // texture to store divergence - no front and back is needed as divergence is never written and read in the same step
  const divergenceTexture4 = makeTexture(gl, canvas, 4, gl.R32F, gl.RED, gl.FLOAT, 1);
  const divergeneIndex = 4;
  const divergenceFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, divergenceFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, divergenceTexture4, 0);

  // texture to store "barrier" mask - created from maskCanvas. 0 alpha = no barrier, 1 alpha = barrier
  const barrierTexture5 = makeTexture(gl, canvas, 5, gl.ALPHA, gl.ALPHA, gl.UNSIGNED_BYTE, 1, maskCanvas);
  const barrierIndex = 5;

  // pre-drawing initializations - note that vao was already bound, and won't be changed during ticking!
  gl.viewport(0, 0, canvas.width, canvas.height);

  // tick every frame
  let prevMousePos = { x: -1, y: -1 };
  function tick() {
    // calculate velocity and pressure for this frame
    swapVelocity();
    mouseVelocity(frontVelocityIndex, prevMousePos, mousePos);
    swapVelocity();
    advectVelocity(frontVelocityIndex, barrierIndex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, divergenceFramebuffer);
    divergence(backVelocityIndex);
    for(let i = 0; i < 10; ++i) {
      swapPressure();
      jacobiPressure(divergeneIndex, frontPressureIndex);
    }
    swapVelocity();
    gradientPressure(frontVelocityIndex, backPressureIndex, barrierIndex);

    // draw actual output to user
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    drawing(backVelocityIndex, backPressureIndex, barrierIndex);

    prevMousePos = mousePos;
    curAnimationFrame = requestAnimationFrame(tick);
  }
  curAnimationFrame = requestAnimationFrame(tick);
}

// function initDrawing() {
//   // ensure sim canvas is hidden
//   const canvas = document.getElementById('canvas');
//   canvas.style.display = 'none';
//
//   // setup mask canvas context
//   const maskCanvas = document.getElementById('mask-canvas');
//   const ctx = maskCanvas.getContext('2d');
//   ctx.lineCap = 'round';
//   ctx.lineWidth = 10;
//
//   // draw on maskCanvas
//   let prevMousePos = { x: -1, y: -1 };
//   function tick() {
//     if(isMouseDown) {
//       ctx.beginPath();
//       ctx.moveTo(prevMousePos.x, canvasHeight-prevMousePos.y);
//       ctx.lineTo(mousePos.x, canvasHeight-mousePos.y);
//       ctx.stroke();
//     }
//
//     prevMousePos = mousePos;
//     curAnimationFrame = requestAnimationFrame(tick);
//   }
//   curAnimationFrame = requestAnimationFrame(tick);
// }

function reset(redraw=false) {
  cancelAnimationFrame(curAnimationFrame);
  init(redraw);
}

function onSimScaleChange(change) {
  const value = change.value;
  simScale = eval(value);
  reset(true);
}

function onPresetWallsChange(change) {
  const value = change.value;
  presetWalls = value;
  reset(true);
}

init(true);

