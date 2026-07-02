import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader }  from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// ── Main component ────────────────────────────────────────────────────────────
// A solid, smoothly-shaded 3-D brain that gently rotates and can be dragged.
// No wireframe, scan ring, or crosshair — just the brain.
export default function BrainModel({ className }) {
  const mountRef = useRef(null)
  const stRef    = useRef({ ry: 0.30, rx: 0.12, drag: false, px: 0, py: 0 })
  const rafRef   = useRef(null)

  useEffect(() => {
    const el  = mountRef.current
    const W   = el.clientWidth  || 480
    const H   = el.clientHeight || 480
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 50)
    camera.position.set(0, 0.05, 3.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(dpr)
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.style.cssText = 'display:block;width:100%;height:100%;'
    el.appendChild(canvas)

    // ── Lighting — soft, natural, gives the surface gentle depth ────────────
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a86, 1.05))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(1.4, 1.8, 2.2)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xdfeaf0, 0.45)
    fill.position.set(-2.0, -0.6, 1.0)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0x9fb8c4, 0.4)
    rim.position.set(0, 0.5, -2.5)
    scene.add(rim)

    // Loading label (removed once the brain is ready)
    const label = document.createElement('div')
    label.style.cssText = `
      position:absolute;inset:0;display:flex;align-items:center;
      justify-content:center;color:rgba(0,200,180,0.55);
      font-family:'JetBrains Mono',monospace;font-size:0.75rem;
      letter-spacing:.08em;pointer-events:none;
    `
    label.textContent = 'LOADING BRAIN MODEL…'
    el.style.position = 'relative'
    el.appendChild(label)

    // Brain group — rotates as one
    const brain = new THREE.Group()
    scene.add(brain)

    // ── GLTF + DRACO Loader ─────────────────────────────────────────────────
    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    draco.preload()

    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)
    loader.load(
      '/brain.draco.glb',
      (gltf) => {
        const geos = []
        gltf.scene.traverse(c => { if (c.isMesh) geos.push(c.geometry.clone()) })
        if (!geos.length) return
        const geo = geos[0]

        // Normalise: centre + scale to fit
        geo.computeBoundingBox()
        const bb = geo.boundingBox
        const centre = new THREE.Vector3()
        bb.getCenter(centre)
        geo.translate(-centre.x, -centre.y, -centre.z)

        const size = new THREE.Vector3()
        bb.getSize(size)
        const scale = 1.80 / Math.max(size.x, size.y, size.z)
        geo.scale(scale, scale, scale)
        geo.computeVertexNormals()   // smooth shading

        // Solid, matte brain surface — soft anatomical tone
        const mat = new THREE.MeshStandardMaterial({
          color: 0xc9b6ad,
          roughness: 0.82,
          metalness: 0.04,
          flatShading: false,
        })
        brain.add(new THREE.Mesh(geo, mat))

        draco.dispose()
        if (el.contains(label)) el.removeChild(label)
      },
      undefined,
      (err) => {
        label.textContent = 'Could not load brain model'
        console.error(err)
      },
    )

    // ── Animation loop — gentle idle spin ───────────────────────────────────
    function animate() {
      const s = stRef.current
      if (!s.drag) s.ry += 0.0038
      brain.rotation.y = s.ry
      brain.rotation.x = s.rx
      renderer.render(scene, camera)
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    // ── Pointer drag to rotate ──────────────────────────────────────────────
    canvas.style.cursor = 'grab'
    canvas.style.touchAction = 'none'

    function onDown(e) {
      stRef.current.drag = true
      stRef.current.px = e.clientX
      stRef.current.py = e.clientY
      canvas.style.cursor = 'grabbing'
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    function onMove(e) {
      if (!stRef.current.drag) return
      const dx = e.clientX - stRef.current.px
      const dy = e.clientY - stRef.current.py
      stRef.current.ry += dx * 0.009
      stRef.current.rx  = Math.max(-0.72, Math.min(0.72, stRef.current.rx + dy * 0.009))
      stRef.current.px = e.clientX
      stRef.current.py = e.clientY
    }
    function onUp() { stRef.current.drag = false; canvas.style.cursor = 'grab' }

    canvas.addEventListener('pointerdown',   onDown)
    canvas.addEventListener('pointermove',   onMove)
    canvas.addEventListener('pointerup',     onUp)
    canvas.addEventListener('pointercancel', onUp)

    return () => {
      cancelAnimationFrame(rafRef.current)
      canvas.removeEventListener('pointerdown',   onDown)
      canvas.removeEventListener('pointermove',   onMove)
      canvas.removeEventListener('pointerup',     onUp)
      canvas.removeEventListener('pointercancel', onUp)
      renderer.dispose()
      if (el.contains(canvas)) el.removeChild(canvas)
      if (el.contains(label))  el.removeChild(label)
    }
  }, [])

  return <div ref={mountRef} className={className} style={{ overflow: 'hidden' }} />
}
