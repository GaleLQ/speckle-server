import {
  ACESFilmicToneMapping,
  Box3,
  Box3Helper,
  Camera,
  CameraHelper,
  Color,
  DirectionalLight,
  DirectionalLightHelper,
  Group,
  Intersection,
  Mesh,
  Object3D,
  Plane,
  Scene,
  Sphere,
  Spherical,
  sRGBEncoding,
  Texture,
  Vector3,
  VSMShadowMap,
  WebGLRenderer
} from 'three'
import { GeometryType } from './batching/Batch'
import Batcher from './batching/Batcher'
import { SpeckleType } from './converter/GeometryConverter'
import { FilterMaterial } from './FilteringManager'
import Input, { InputOptionsDefault } from './input/Input'
import { Intersections } from './Intersections'
import SpeckleStandardMaterial from './materials/SpeckleStandardMaterial'
import { NodeRenderView } from './tree/NodeRenderView'
import { Viewer } from './Viewer'

export default class SpeckleRenderer {
  private readonly SHOW_HELPERS = true
  private _renderer: WebGLRenderer
  public scene: Scene
  private rootGroup: Group
  private batcher: Batcher
  private intersections: Intersections
  private input: Input
  private sun: DirectionalLight
  private sunTarget: Object3D
  public viewer: Viewer // TEMPORARY
  private filterBatchRecording: string[]

  public get renderer(): WebGLRenderer {
    return this._renderer
  }

  public set indirectIBL(texture: Texture) {
    this.scene.environment = texture
  }

  /** TEMPORARY for backwards compatibility */
  public get allObjects() {
    return this.scene.getObjectByName('ContentGroup')
  }

  public get sceneBox() {
    return new Box3().setFromObject(this.allObjects)
  }

  public get sceneSphere() {
    return this.sceneBox.getBoundingSphere(new Sphere())
  }

  public get sceneCenter() {
    return this.sceneBox.getCenter(new Vector3())
  }

  public constructor(viewer: Viewer /** TEMPORARY */) {
    this.scene = new Scene()
    this.rootGroup = new Group()
    this.rootGroup.name = 'ContentGroup'
    this.scene.add(this.rootGroup)

    this.batcher = new Batcher()
    this.intersections = new Intersections()
    this.viewer = viewer
  }

  public create(container: HTMLElement) {
    this._renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    })
    this._renderer.setClearColor(0xcccccc, 0)
    this._renderer.setPixelRatio(window.devicePixelRatio)
    this._renderer.outputEncoding = sRGBEncoding
    this._renderer.toneMapping = ACESFilmicToneMapping
    this._renderer.toneMappingExposure = 0.5
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = VSMShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.physicallyCorrectLights = true

    this._renderer.setSize(container.offsetWidth, container.offsetHeight)
    container.appendChild(this._renderer.domElement)

    this.input = new Input(this._renderer.domElement, InputOptionsDefault)
    this.input.on('object-clicked', this.onObjectClick.bind(this))
    this.input.on('object-clicked-debug', this.onObjectClickDebug.bind(this))
    this.input.on('object-doubleclicked', this.onObjectDoubleClick.bind(this))

    this.addDirectLights()
    if (this.SHOW_HELPERS) {
      const helpers = new Group()
      helpers.name = 'Helpers'
      this.scene.add(helpers)

      const sceneBoxHelper = new Box3Helper(this.sceneBox, new Color(0x0000ff))
      sceneBoxHelper.name = 'SceneBoxHelper'
      helpers.add(sceneBoxHelper)

      const dirLightHelper = new DirectionalLightHelper(this.sun, 50, 0xff0000)
      dirLightHelper.name = 'DirLightHelper'
      helpers.add(dirLightHelper)

      const camHelper = new CameraHelper(this.sun.shadow.camera)
      camHelper.name = 'CamHelper'
      helpers.add(camHelper)
    }
  }

  public update(deltaTime: number) {
    this.batcher.update(deltaTime)
  }

  public render(camera: Camera) {
    this.batcher.render(this.renderer)
    this.renderer.render(this.scene, camera)
  }

  public addRenderTree(subtreeId: string) {
    this.batcher.makeBatches(
      subtreeId,
      GeometryType.MESH,
      SpeckleType.Mesh,
      SpeckleType.Brep
    )
    this.batcher.makeBatches(
      subtreeId,
      GeometryType.LINE,
      SpeckleType.Line,
      SpeckleType.Curve,
      SpeckleType.Polycurve,
      SpeckleType.Polyline,
      SpeckleType.Arc,
      SpeckleType.Circle,
      SpeckleType.Ellipse
    )
    this.batcher.makeBatches(
      subtreeId,
      GeometryType.POINT,
      SpeckleType.Point,
      SpeckleType.Pointcloud
    )

    const subtreeGroup = new Group()
    subtreeGroup.name = subtreeId
    this.rootGroup.add(subtreeGroup)

    for (const k in this.batcher.batches) {
      const batch = this.batcher.batches[k]
      const batchRenderable = batch.renderObject
      subtreeGroup.add(this.batcher.batches[k].renderObject)
      if ((batchRenderable as Mesh).isMesh) {
        const mesh = batchRenderable as unknown as Mesh
        const material = mesh.material as SpeckleStandardMaterial
        batchRenderable.castShadow = !material.transparent
        batchRenderable.receiveShadow = !material.transparent
      }
    }

    this.updateDirectLights(0.47, 0)
    this.updateHelpers()
  }

  public removeRenderTree(subtreeId: string) {
    this.rootGroup.remove(this.scene.getObjectByName(subtreeId))
    this.batcher.purgeBatches(subtreeId)
    this.scene.remove(this.sun, this.sunTarget)
    // if (this.SHOW_HELPERS) {
    //   this.scene.remove(this.scene.getObjectByName('Helpers'))
    // }
  }

  public clearFilter() {
    this.batcher.resetBatchesDrawRanges()
    this.filterBatchRecording = []
  }

  public applyFilter(ids: NodeRenderView[], filterMaterial: FilterMaterial) {
    this.filterBatchRecording.push(
      ...this.batcher.setObjectsFilterMaterial(ids, filterMaterial)
    )
  }

  public beginFilter() {
    this.filterBatchRecording = []
  }

  public endFilter() {
    this.batcher.autoFillDrawRanges(this.filterBatchRecording)
  }

  public updateClippingPlanes(planes: Plane[]) {
    if (!this.allObjects) return
    this.allObjects.traverse((object) => {
      const material = (object as unknown as { material }).material
      if (material) {
        material.clippingPlanes = planes
      }
    })
  }

  private addDirectLights() {
    this.sun = new DirectionalLight(0xffffff, 5)
    this.sun.name = 'sun'
    this.scene.add(this.sun)

    this.sun.castShadow = true

    this.sun.shadow.mapSize.width = 2048
    this.sun.shadow.mapSize.height = 2048

    const d = 50

    this.sun.shadow.camera.left = -d
    this.sun.shadow.camera.right = d
    this.sun.shadow.camera.top = d
    this.sun.shadow.camera.bottom = -d
    this.sun.shadow.bias = 0.5
    this.sun.shadow.camera.near = 5
    this.sun.shadow.camera.far = 350
    this.sun.shadow.bias = -0.0001

    this.sunTarget = new Object3D()
    this.scene.add(this.sunTarget)
    this.sunTarget.position.copy(this.sceneCenter)
    this.sun.target = this.sunTarget
  }

  public updateDirectLights(phi: number, theta: number, radiusOffset = 0) {
    this.sunTarget.position.copy(this.sceneCenter)
    const spherical = new Spherical(this.sceneSphere.radius + radiusOffset, phi, theta)
    this.sun.position.setFromSpherical(spherical)
    this.sun.position.add(this.sunTarget.position)
    this.sun.updateWorldMatrix(true, true)
    this.sunTarget.updateMatrixWorld()
    this.sun.shadow.updateMatrices(this.sun)
    const box = this.sceneBox
    const low = box.min
    const high = box.max

    /** Get the 8 vertices of the world space bounding box */
    const corner1 = new Vector3(low.x, low.y, low.z)
    const corner2 = new Vector3(high.x, low.y, low.z)
    const corner3 = new Vector3(low.x, high.y, low.z)
    const corner4 = new Vector3(low.x, low.y, high.z)

    const corner5 = new Vector3(high.x, high.y, low.z)
    const corner6 = new Vector3(high.x, low.y, high.z)
    const corner7 = new Vector3(low.x, high.y, high.z)
    const corner8 = new Vector3(high.x, high.y, high.z)

    /** Transform them to light space */
    corner1.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner2.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner3.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner4.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner5.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner6.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner7.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    corner8.applyMatrix4(this.sun.shadow.camera.matrixWorldInverse)
    /** Compute the light space bounding box */
    const lightSpaceBox = new Box3().setFromPoints([
      corner1,
      corner2,
      corner3,
      corner4,
      corner5,
      corner6,
      corner7,
      corner8
    ])
    this.sun.shadow.camera.left = lightSpaceBox.min.x
    this.sun.shadow.camera.right = lightSpaceBox.max.x
    this.sun.shadow.camera.top = lightSpaceBox.min.y
    this.sun.shadow.camera.bottom = lightSpaceBox.max.y
    /** z is negative so smaller is actually 'larger' */
    this.sun.shadow.camera.near = Math.abs(lightSpaceBox.max.z)
    this.sun.shadow.camera.far = Math.abs(lightSpaceBox.min.z)
    this.sun.shadow.camera.updateProjectionMatrix()
    this.renderer.shadowMap.needsUpdate = true
  }

  private updateHelpers() {
    if (this.SHOW_HELPERS) {
      ;(this.scene.getObjectByName('CamHelper') as CameraHelper).update()
      ;(this.scene.getObjectByName('SceneBoxHelper') as Box3Helper).box.copy(
        this.sceneBox
      )
    }
  }

  private onObjectClick(e) {
    const result: Intersection = this.intersections.intersect(
      this.scene,
      this.viewer.cameraHandler.activeCam.camera,
      e
    )
    if (!result) {
      this.batcher.resetBatchesDrawRanges()
      return
    }

    // console.warn(result)
    const rv = this.batcher.getRenderView(
      result.object.uuid,
      result.faceIndex !== undefined ? result.faceIndex : result.index
    )
    const hitId = rv.renderData.id

    // const hitNode = WorldTree.getInstance().findId(hitId)

    this.batcher.resetBatchesDrawRanges()

    this.batcher.isolateRenderView(hitId)
    /** In case the above call has breaking bugs, just use this instead */
    // this.batcher.autoFillDrawRanges(
    //   this.batcher.setObjectsFilterMaterial([hitNode.model.id], {
    //     filterType: FilterMaterialType.SELECT
    //   })
    // )
  }

  private onObjectDoubleClick(e) {
    const result: Intersection = this.intersections.intersect(
      this.scene,
      this.viewer.cameraHandler.activeCam.camera,
      e
    )
    let rv = null
    if (!result) {
      if (this.viewer.sectionBox.display.visible) {
        this.zoomToBox(this.viewer.sectionBox.cube, 1.2, true)
      } else {
        this.zoomExtents()
      }
    } else {
      rv = this.batcher.getRenderView(
        result.object.uuid,
        result.faceIndex !== undefined ? result.faceIndex : result.index
      )
      this.zoomToBox(rv.aabb, 1.2, true)
    }

    this.viewer.needsRender = true
    this.viewer.emit(
      'object-doubleclicked',
      result ? rv.renderData.id : null,
      result ? result.point : null
    )
  }

  /** Taken from InteractionsHandler. Will revisit in the future */
  public zoomExtents(fit = 1.2, transition = true) {
    if (this.viewer.sectionBox.display.visible) {
      this.zoomToBox(this.viewer.sectionBox.cube.geometry.boundingBox, 1.2, true)
      return
    }
    if (this.allObjects.children.length === 0) {
      const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
      this.zoomToBox(box, fit, transition)
      return
    }

    const box = new Box3().setFromObject(this.allObjects)
    this.zoomToBox(box, fit, transition)
    // this.viewer.controls.setBoundary( box )
  }

  /** Taken from InteractionsHandler. Will revisit in the future */
  zoomToBox(box, fit = 1.2, transition = true) {
    if (box.max.x === Infinity || box.max.x === -Infinity) {
      box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))
    }
    const fitOffset = fit

    const size = box.getSize(new Vector3())
    const target = new Sphere()
    box.getBoundingSphere(target)
    target.radius = target.radius * fitOffset

    const maxSize = Math.max(size.x, size.y, size.z)
    const camFov = this.viewer.cameraHandler.camera.fov
      ? this.viewer.cameraHandler.camera.fov
      : 55
    const camAspect = this.viewer.cameraHandler.camera.aspect
      ? this.viewer.cameraHandler.camera.aspect
      : 1.2
    const fitHeightDistance = maxSize / (2 * Math.atan((Math.PI * camFov) / 360))
    const fitWidthDistance = fitHeightDistance / camAspect
    const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance)

    this.viewer.cameraHandler.controls.fitToSphere(target, transition)

    this.viewer.cameraHandler.controls.minDistance = distance / 100
    this.viewer.cameraHandler.controls.maxDistance = distance * 100
    this.viewer.cameraHandler.camera.near = distance / 100
    this.viewer.cameraHandler.camera.far = distance * 100
    this.viewer.cameraHandler.camera.updateProjectionMatrix()

    if (this.viewer.cameraHandler.activeCam.name === 'ortho') {
      this.viewer.cameraHandler.orthoCamera.far = distance * 100
      this.viewer.cameraHandler.orthoCamera.updateProjectionMatrix()

      // fit the camera inside, so we don't have clipping plane issues.
      // WIP implementation
      const camPos = this.viewer.cameraHandler.orthoCamera.position
      let dist = target.distanceToPoint(camPos)
      if (dist < 0) {
        dist *= -1
        this.viewer.cameraHandler.controls.setPosition(
          camPos.x + dist,
          camPos.y + dist,
          camPos.z + dist
        )
      }
    }
  }

  /** DEBUG */
  public onObjectClickDebug(e) {
    const result: Intersection = this.intersections.intersect(
      this.scene,
      this.viewer.cameraHandler.activeCam.camera,
      e
    )
    if (!result) {
      this.batcher.resetBatchesDrawRanges()
      return
    }

    // console.warn(result)
    const rv = this.batcher.getRenderView(
      result.object.uuid,
      result.faceIndex !== undefined ? result.faceIndex : result.index
    )
    const hitId = rv.renderData.id

    // const hitNode = WorldTree.getInstance().findId(hitId)

    this.batcher.resetBatchesDrawRanges()

    this.batcher.isolateRenderViewBatch(hitId)
  }

  public debugShowBatches() {
    this.batcher.resetBatchesDrawRanges()
    for (const k in this.batcher.batches) {
      this.batcher.batches[k].setDrawRanges({
        offset: 0,
        count: Infinity,
        material: this.batcher.materials.getDebugBatchMaterial(
          this.batcher.batches[k].getRenderView(0)
        )
      })
    }
  }
}
