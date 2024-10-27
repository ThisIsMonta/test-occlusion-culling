import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'

var camera, scene, renderer, light, controls
var spheres = []
var NUM_SPHERES,
  occludedSpheres = 0
var gl
var boundingBoxPositions
var boundingBoxProgram,
  boundingBoxArray,
  boundingBoxModelMatrixLocation,
  viewProjMatrixLocation
var viewMatrix, projMatrix
var firstRender = true

var sphereCountElement = document.getElementById('num-spheres')
var occludedSpheresElement = document.getElementById('num-invisible-spheres')
var numVertices = document.getElementById('num-vertices')

// depth sort variables
var sortPositionA = new THREE.Vector3()
var sortPositionB = new THREE.Vector3()
var sortModelView = new THREE.Matrix4()

const stats = Stats()

document.body.appendChild(stats.dom)

init()
animate()

function init () {
  scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0x222222))
  scene.background = new THREE.Color(0xdddddd)
  light = new THREE.DirectionalLight(0xffffff, 1)
  scene.add(light)

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    1,
    10000
  )

  camera.position.set(0, 5, 5)
  camera.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  document.body.appendChild(renderer.domElement)

  var offscreenCanvas = new OffscreenCanvas(
    window.innerWidth,
    window.innerHeight
  )
  gl = offscreenCanvas.getContext('webgl2')

  if (!gl) {
    console.error('WebGL 2 not available')
    document.body.innerHTML =
      'This example requires WebGL 2 which is unavailable on this system.'
  }

  var GRID_DIM = 10
  var GRID_OFFSET = GRID_DIM / 2 - 0.5
  NUM_SPHERES = GRID_DIM * GRID_DIM
  sphereCountElement.innerHTML = NUM_SPHERES

  var geometry = new THREE.SphereGeometry(20, 16, 16)
  var material = new THREE.MeshPhongMaterial({
    color: 0xff0000,
    specular: 0x050505,
    shininess: 50,
    emissive: 0x000000,
  })
  geometry.computeBoundingBox()

  let length = 0

  for (var i = 0; i < NUM_SPHERES; i++) {
    var x = Math.floor(i / GRID_DIM) - GRID_OFFSET
    var z = (i % GRID_DIM) - GRID_OFFSET
    var mesh = new THREE.Mesh(geometry, material)
    length += mesh.geometry.index.array.length
    spheres.push(mesh)
    scene.add(mesh)

    mesh.position.set(x * 35, 0, z * 35)
    mesh.userData.query = gl.createQuery()
    mesh.userData.queryInProgress = false
    mesh.userData.occluded = false
  }

  console.log(`${length} polygons`);
  numVertices.innerHTML = length

  controls = new OrbitControls(camera, renderer.domElement)
  controls.minDistance = 3

  //////////////////////////
  // WebGL code
  //////////////////////////

  // boundingbox shader

  var boundingBoxVSource = document
    .getElementById('vertex-boundingBox')
    .text.trim()
  var boundingBoxFSource = document
    .getElementById('fragment-boundingBox')
    .text.trim()
  var boundingBoxVertexShader = gl.createShader(gl.VERTEX_SHADER)
  gl.shaderSource(boundingBoxVertexShader, boundingBoxVSource)
  gl.compileShader(boundingBoxVertexShader)

  if (!gl.getShaderParameter(boundingBoxVertexShader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(boundingBoxVertexShader))
  }

  var boundingBoxFragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
  gl.shaderSource(boundingBoxFragmentShader, boundingBoxFSource)
  gl.compileShader(boundingBoxFragmentShader)

  if (!gl.getShaderParameter(boundingBoxFragmentShader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(boundingBoxFragmentShader))
  }

  boundingBoxProgram = gl.createProgram()
  gl.attachShader(boundingBoxProgram, boundingBoxVertexShader)
  gl.attachShader(boundingBoxProgram, boundingBoxFragmentShader)
  gl.linkProgram(boundingBoxProgram)

  if (!gl.getProgramParameter(boundingBoxProgram, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(boundingBoxProgram))
  }

  // uniform location

  boundingBoxModelMatrixLocation = gl.getUniformLocation(
    boundingBoxProgram,
    'uModel'
  )
  viewProjMatrixLocation = gl.getUniformLocation(
    boundingBoxProgram,
    'uViewProj'
  )

  // vertex location

  boundingBoxPositions = computeBoundingBoxPositions(geometry.boundingBox)

  boundingBoxArray = gl.createVertexArray()
  gl.bindVertexArray(boundingBoxArray)

  var positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, boundingBoxPositions, gl.STATIC_DRAW)
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(0)

  gl.bindVertexArray(null)

  window.addEventListener('resize', onWindowResize, false)
}

function onWindowResize () {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()

  renderer.setSize(window.innerWidth, window.innerHeight)
}

function animate () {
  requestAnimationFrame(animate)
  render()
  stats.update()
}

function depthSort (a, b) {
  sortPositionA.copy(a.position)
  sortPositionB.copy(b.position)

  sortModelView.copy(viewMatrix).multiply(a.matrix)
  sortPositionA.applyMatrix4(sortModelView)
  sortModelView.copy(viewMatrix).multiply(b.matrix)
  sortPositionB.applyMatrix4(sortModelView)
  return sortPositionB.z - sortPositionA.z
}

function render () {
  var timer = Date.now() * 0.0001
  // camera.position.x = Math.cos( timer ) * 250;
  // camera.position.z = Math.sin( timer ) * 250;
  camera.lookAt(scene.position)
  light.position.copy(camera.position)

  occludedSpheres = 0

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.clearColor(0, 0, 0, 1)
  gl.enable(gl.DEPTH_TEST)
  gl.colorMask(true, true, true, true)
  gl.depthMask(true)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  if (!firstRender) {
    viewMatrix = camera.matrixWorldInverse.clone()
    projMatrix = camera.projectionMatrix.clone()
    var viewProjMatrix = projMatrix.multiply(viewMatrix)

    spheres.sort(depthSort)

    // for occlusion test

    gl.colorMask(false, false, false, false)
    //gl.depthMask(false);
    gl.useProgram(boundingBoxProgram)
    gl.bindVertexArray(boundingBoxArray)

    for (var i = 0; i < NUM_SPHERES; i++) {
      spheres[i].visible = true
      spheres[i].rotation.y += 0.003

      var sphereData = spheres[i].userData

      gl.uniformMatrix4fv(
        boundingBoxModelMatrixLocation,
        false,
        spheres[i].matrix.elements
      )
      gl.uniformMatrix4fv(
        viewProjMatrixLocation,
        false,
        viewProjMatrix.elements
      )
      gl.uniform4f(
        gl.getUniformLocation(boundingBoxProgram, 'color'),
        i / NUM_SPHERES,
        0,
        0,
        1
      )

      if (
        sphereData.queryInProgress &&
        gl.getQueryParameter(sphereData.query, gl.QUERY_RESULT_AVAILABLE)
      ) {
        sphereData.occluded = !gl.getQueryParameter(
          sphereData.query,
          gl.QUERY_RESULT
        )
        if (sphereData.occluded) occludedSpheres++
        sphereData.queryInProgress = false
      }

      if (!sphereData.queryInProgress) {
        gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, sphereData.query)
        gl.drawArrays(gl.TRIANGLES, 0, boundingBoxPositions.length / 3)
        gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE)
        sphereData.queryInProgress = true
      }

      if (sphereData.occluded) {
        spheres[i].visible = false
      }
    }
    gl.flush()

    occludedSpheresElement.innerHTML = occludedSpheres
  }

  firstRender = false

  renderer.render(scene, camera)
}

function computeBoundingBoxPositions (box) {
  var dimension = box.max.sub(box.min)
  var width = dimension.x
  var height = dimension.y
  var depth = dimension.z
  var x = box.min.x
  var y = box.min.y
  var z = box.min.z

  var fbl = { x: x, y: y, z: z + depth }
  var fbr = { x: x + width, y: y, z: z + depth }
  var ftl = { x: x, y: y + height, z: z + depth }
  var ftr = { x: x + width, y: y + height, z: z + depth }
  var bbl = { x: x, y: y, z: z }
  var bbr = { x: x + width, y: y, z: z }
  var btl = { x: x, y: y + height, z: z }
  var btr = { x: x + width, y: y + height, z: z }

  var positions = new Float32Array([
    //front
    fbl.x,
    fbl.y,
    fbl.z,
    fbr.x,
    fbr.y,
    fbr.z,
    ftl.x,
    ftl.y,
    ftl.z,
    ftl.x,
    ftl.y,
    ftl.z,
    fbr.x,
    fbr.y,
    fbr.z,
    ftr.x,
    ftr.y,
    ftr.z,

    //right
    fbr.x,
    fbr.y,
    fbr.z,
    bbr.x,
    bbr.y,
    bbr.z,
    ftr.x,
    ftr.y,
    ftr.z,
    ftr.x,
    ftr.y,
    ftr.z,
    bbr.x,
    bbr.y,
    bbr.z,
    btr.x,
    btr.y,
    btr.z,

    //back
    fbr.x,
    bbr.y,
    bbr.z,
    bbl.x,
    bbl.y,
    bbl.z,
    btr.x,
    btr.y,
    btr.z,
    btr.x,
    btr.y,
    btr.z,
    bbl.x,
    bbl.y,
    bbl.z,
    btl.x,
    btl.y,
    btl.z,

    //left
    bbl.x,
    bbl.y,
    bbl.z,
    fbl.x,
    fbl.y,
    fbl.z,
    btl.x,
    btl.y,
    btl.z,
    btl.x,
    btl.y,
    btl.z,
    fbl.x,
    fbl.y,
    fbl.z,
    ftl.x,
    ftl.y,
    ftl.z,

    //top
    ftl.x,
    ftl.y,
    ftl.z,
    ftr.x,
    ftr.y,
    ftr.z,
    btl.x,
    btl.y,
    btl.z,
    btl.x,
    btl.y,
    btl.z,
    ftr.x,
    ftr.y,
    ftr.z,
    btr.x,
    btr.y,
    btr.z,

    //bottom
    bbl.x,
    bbl.y,
    bbl.z,
    bbr.x,
    bbr.y,
    bbr.z,
    fbl.x,
    fbl.y,
    fbl.z,
    fbl.x,
    fbl.y,
    fbl.z,
    bbr.x,
    bbr.y,
    bbr.z,
    fbr.x,
    fbr.y,
    fbr.z
  ])

  return positions
}
