import * as GLTF2 from "babylonjs-gltf2interface";
import { Nullable } from "babylonjs/types";
import { Observable, Observer } from "babylonjs/Misc/observable";
import { Tools } from "babylonjs/Misc/tools";
import { Camera } from "babylonjs/Cameras/camera";
import { AnimationGroup } from "babylonjs/Animations/animationGroup";
import { Skeleton } from "babylonjs/Bones/skeleton";
import { IParticleSystem } from "babylonjs/Particles/IParticleSystem";
import { BaseTexture } from "babylonjs/Materials/Textures/baseTexture";
import { Material } from "babylonjs/Materials/material";
import { AbstractMesh } from "babylonjs/Meshes/abstractMesh";
import { SceneLoader, ISceneLoaderPluginFactory, ISceneLoaderPlugin, ISceneLoaderPluginAsync, SceneLoaderProgressEvent, ISceneLoaderPluginExtensions } from "babylonjs/Loading/sceneLoader";
import { AssetContainer } from "babylonjs/assetContainer";
import { Scene, IDisposable } from "babylonjs/scene";
import { WebRequest } from "babylonjs/Misc/webRequest";
import { IFileRequest } from "babylonjs/Misc/fileRequest";
import { Logger } from 'babylonjs/Misc/logger';
import { DataReader, IDataBuffer } from './dataReader';

/**
 * glTF validator object
 */
declare var GLTFValidator: GLTF2.IGLTFValidator;

/**
 * Mode that determines the coordinate system to use.
 */
export enum GLTFLoaderCoordinateSystemMode {
    /**
     * Automatically convert the glTF right-handed data to the appropriate system based on the current coordinate system mode of the scene.
     */
    AUTO,

    /**
     * Sets the useRightHandedSystem flag on the scene.
     */
    FORCE_RIGHT_HANDED,
}

/**
 * Mode that determines what animations will start.
 */
export enum GLTFLoaderAnimationStartMode {
    /**
     * No animation will start.
     */
    NONE,

    /**
     * The first animation will start.
     */
    FIRST,

    /**
     * All animations will start.
     */
    ALL,
}

/**
 * Interface that contains the data for the glTF asset.
 */
export interface IGLTFLoaderData {
    /**
     * The object that represents the glTF JSON.
     */
    json: Object;

    /**
     * The BIN chunk of a binary glTF.
     */
    bin: Nullable<IDataBuffer>;
}

/**
 * Interface for extending the loader.
 */
export interface IGLTFLoaderExtension {
    /**
     * The name of this extension.
     */
    readonly name: string;

    /**
     * Defines whether this extension is enabled.
     */
    enabled: boolean;
}

/**
 * Loader state.
 */
export enum GLTFLoaderState {
    /**
     * The asset is loading.
     */
    LOADING,

    /**
     * The asset is ready for rendering.
     */
    READY,

    /**
     * The asset is completely loaded.
     */
    COMPLETE
}

/** @hidden */
export interface IGLTFLoader extends IDisposable {
    readonly state: Nullable<GLTFLoaderState>;
    importMeshAsync: (meshesNames: any, scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: SceneLoaderProgressEvent) => void, fileName?: string) => Promise<{ meshes: AbstractMesh[], particleSystems: IParticleSystem[], skeletons: Skeleton[], animationGroups: AnimationGroup[] }>;
    loadAsync: (scene: Scene, data: IGLTFLoaderData, rootUrl: string, onProgress?: (event: SceneLoaderProgressEvent) => void, fileName?: string) => Promise<void>;
}

/**
 * File loader for loading glTF files into a scene.
 */
export class GLTFFileLoader implements IDisposable, ISceneLoaderPluginAsync, ISceneLoaderPluginFactory {
    /** @hidden */
    public static _CreateGLTF1Loader: (parent: GLTFFileLoader) => IGLTFLoader;

    /** @hidden */
    public static _CreateGLTF2Loader: (parent: GLTFFileLoader) => IGLTFLoader;

    // --------------
    // Common options
    // --------------

    /**
     * Raised when the asset has been parsed
     */
    public onParsedObservable = new Observable<IGLTFLoaderData>();

    private _onParsedObserver: Nullable<Observer<IGLTFLoaderData>>;

    /**
     * Raised when the asset has been parsed
     */
    public set onParsed(callback: (loaderData: IGLTFLoaderData) => void) {
        if (this._onParsedObserver) {
            this.onParsedObservable.remove(this._onParsedObserver);
        }
        this._onParsedObserver = this.onParsedObservable.add(callback);
    }

    // ----------
    // V1 options
    // ----------

    /**
     * Set this property to false to disable incremental loading which delays the loader from calling the success callback until after loading the meshes and shaders.
     * Textures always loads asynchronously. For example, the success callback can compute the bounding information of the loaded meshes when incremental loading is disabled.
     * Defaults to true.
     * @hidden
     */
    public static IncrementalLoading = true;

    /**
     * Set this property to true in order to work with homogeneous coordinates, available with some converters and exporters.
     * Defaults to false. See https://en.wikipedia.org/wiki/Homogeneous_coordinates.
     * @hidden
     */
    public static HomogeneousCoordinates = false;

    // ----------
    // V2 options
    // ----------

    /**
     * The coordinate system mode. Defaults to AUTO.
     */
    public coordinateSystemMode = GLTFLoaderCoordinateSystemMode.AUTO;

    /**
    * The animation start mode. Defaults to FIRST.
    */
    public animationStartMode = GLTFLoaderAnimationStartMode.FIRST;

    /**
     * Defines if the loader should compile materials before raising the success callback. Defaults to false.
     */
    public compileMaterials = false;

    /**
     * Defines if the loader should also compile materials with clip planes. Defaults to false.
     */
    public useClipPlane = false;

    /**
     * Defines if the loader should compile shadow generators before raising the success callback. Defaults to false.
     */
    public compileShadowGenerators = false;

    /**
     * Defines if the Alpha blended materials are only applied as coverage.
     * If false, (default) The luminance of each pixel will reduce its opacity to simulate the behaviour of most physical materials.
     * If true, no extra effects are applied to transparent pixels.
     */
    public transparencyAsCoverage = false;

    /**
     * Defines if the loader should use range requests when load binary glTF files from HTTP.
     * Enabling will disable offline support and glTF validator.
     * Defaults to false.
     */
    public useRangeRequests = false;

    /**
     * Defines if the loader should create instances when multiple glTF nodes point to the same glTF mesh. Defaults to true.
     */
    public createInstances = true;

    /**
     * Function called before loading a url referenced by the asset.
     */
    public preprocessUrlAsync = (url: string) => Promise.resolve(url);

    /**
     * Observable raised when the loader creates a mesh after parsing the glTF properties of the mesh.
     */
    public readonly onMeshLoadedObservable = new Observable<AbstractMesh>();

    private _onMeshLoadedObserver: Nullable<Observer<AbstractMesh>>;

    /**
     * Callback raised when the loader creates a mesh after parsing the glTF properties of the mesh.
     */
    public set onMeshLoaded(callback: (mesh: AbstractMesh) => void) {
        if (this._onMeshLoadedObserver) {
            this.onMeshLoadedObservable.remove(this._onMeshLoadedObserver);
        }
        this._onMeshLoadedObserver = this.onMeshLoadedObservable.add(callback);
    }

    /**
     * Observable raised when the loader creates a texture after parsing the glTF properties of the texture.
     */
    public readonly onTextureLoadedObservable = new Observable<BaseTexture>();

    private _onTextureLoadedObserver: Nullable<Observer<BaseTexture>>;

    /**
     * Callback raised when the loader creates a texture after parsing the glTF properties of the texture.
     */
    public set onTextureLoaded(callback: (texture: BaseTexture) => void) {
        if (this._onTextureLoadedObserver) {
            this.onTextureLoadedObservable.remove(this._onTextureLoadedObserver);
        }
        this._onTextureLoadedObserver = this.onTextureLoadedObservable.add(callback);
    }

    /**
     * Observable raised when the loader creates a material after parsing the glTF properties of the material.
     */
    public readonly onMaterialLoadedObservable = new Observable<Material>();

    private _onMaterialLoadedObserver: Nullable<Observer<Material>>;

    /**
     * Callback raised when the loader creates a material after parsing the glTF properties of the material.
     */
    public set onMaterialLoaded(callback: (material: Material) => void) {
        if (this._onMaterialLoadedObserver) {
            this.onMaterialLoadedObservable.remove(this._onMaterialLoadedObserver);
        }
        this._onMaterialLoadedObserver = this.onMaterialLoadedObservable.add(callback);
    }

    /**
     * Observable raised when the loader creates a camera after parsing the glTF properties of the camera.
     */
    public readonly onCameraLoadedObservable = new Observable<Camera>();

    private _onCameraLoadedObserver: Nullable<Observer<Camera>>;

    /**
     * Callback raised when the loader creates a camera after parsing the glTF properties of the camera.
     */
    public set onCameraLoaded(callback: (camera: Camera) => void) {
        if (this._onCameraLoadedObserver) {
            this.onCameraLoadedObservable.remove(this._onCameraLoadedObserver);
        }
        this._onCameraLoadedObserver = this.onCameraLoadedObservable.add(callback);
    }

    /**
     * Observable raised when the asset is completely loaded, immediately before the loader is disposed.
     * For assets with LODs, raised when all of the LODs are complete.
     * For assets without LODs, raised when the model is complete, immediately after the loader resolves the returned promise.
     */
    public readonly onCompleteObservable = new Observable<void>();

    private _onCompleteObserver: Nullable<Observer<void>>;

    /**
     * Callback raised when the asset is completely loaded, immediately before the loader is disposed.
     * For assets with LODs, raised when all of the LODs are complete.
     * For assets without LODs, raised when the model is complete, immediately after the loader resolves the returned promise.
     */
    public set onComplete(callback: () => void) {
        if (this._onCompleteObserver) {
            this.onCompleteObservable.remove(this._onCompleteObserver);
        }
        this._onCompleteObserver = this.onCompleteObservable.add(callback);
    }

    /**
     * Observable raised when an error occurs.
     */
    public readonly onErrorObservable = new Observable<any>();

    private _onErrorObserver: Nullable<Observer<any>>;

    /**
     * Callback raised when an error occurs.
     */
    public set onError(callback: (reason: any) => void) {
        if (this._onErrorObserver) {
            this.onErrorObservable.remove(this._onErrorObserver);
        }
        this._onErrorObserver = this.onErrorObservable.add(callback);
    }

    /**
     * Observable raised after the loader is disposed.
     */
    public readonly onDisposeObservable = new Observable<void>();

    private _onDisposeObserver: Nullable<Observer<void>>;

    /**
     * Callback raised after the loader is disposed.
     */
    public set onDispose(callback: () => void) {
        if (this._onDisposeObserver) {
            this.onDisposeObservable.remove(this._onDisposeObserver);
        }
        this._onDisposeObserver = this.onDisposeObservable.add(callback);
    }

    /**
     * Observable raised after a loader extension is created.
     * Set additional options for a loader extension in this event.
     */
    public readonly onExtensionLoadedObservable = new Observable<IGLTFLoaderExtension>();

    private _onExtensionLoadedObserver: Nullable<Observer<IGLTFLoaderExtension>>;

    /**
     * Callback raised after a loader extension is created.
     */
    public set onExtensionLoaded(callback: (extension: IGLTFLoaderExtension) => void) {
        if (this._onExtensionLoadedObserver) {
            this.onExtensionLoadedObservable.remove(this._onExtensionLoadedObserver);
        }
        this._onExtensionLoadedObserver = this.onExtensionLoadedObservable.add(callback);
    }

    /**
     * Defines if the loader logging is enabled.
     */
    public get loggingEnabled(): boolean {
        return this._loggingEnabled;
    }

    public set loggingEnabled(value: boolean) {
        if (this._loggingEnabled === value) {
            return;
        }

        this._loggingEnabled = value;

        if (this._loggingEnabled) {
            this._log = this._logEnabled;
        }
        else {
            this._log = this._logDisabled;
        }
    }

    /**
     * Defines if the loader should capture performance counters.
     */
    public get capturePerformanceCounters(): boolean {
        return this._capturePerformanceCounters;
    }

    public set capturePerformanceCounters(value: boolean) {
        if (this._capturePerformanceCounters === value) {
            return;
        }

        this._capturePerformanceCounters = value;

        if (this._capturePerformanceCounters) {
            this._startPerformanceCounter = this._startPerformanceCounterEnabled;
            this._endPerformanceCounter = this._endPerformanceCounterEnabled;
        }
        else {
            this._startPerformanceCounter = this._startPerformanceCounterDisabled;
            this._endPerformanceCounter = this._endPerformanceCounterDisabled;
        }
    }

    /**
     * Defines if the loader should validate the asset.
     */
    public validate = false;

    /**
     * Observable raised after validation when validate is set to true. The event data is the result of the validation.
     */
    public readonly onValidatedObservable = new Observable<GLTF2.IGLTFValidationResults>();

    private _onValidatedObserver: Nullable<Observer<GLTF2.IGLTFValidationResults>>;

    /**
     * Callback raised after a loader extension is created.
     */
    public set onValidated(callback: (results: GLTF2.IGLTFValidationResults) => void) {
        if (this._onValidatedObserver) {
            this.onValidatedObservable.remove(this._onValidatedObserver);
        }
        this._onValidatedObserver = this.onValidatedObservable.add(callback);
    }

    private _loader: Nullable<IGLTFLoader> = null;

    /**
     * Name of the loader ("gltf")
     */
    public name = "gltf";

    /**
     * Supported file extensions of the loader (.gltf, .glb)
     */
    public extensions: ISceneLoaderPluginExtensions = {
        ".gltf": { isBinary: false },
        ".glb": { isBinary: true }
    };

    /**
     * Disposes the loader, releases resources during load, and cancels any outstanding requests.
     */
    public dispose(): void {
        if (this._loader) {
            this._loader.dispose();
            this._loader = null;
        }

        this._clear();

        this.onDisposeObservable.notifyObservers(undefined);
        this.onDisposeObservable.clear();
    }

    /** @hidden */
    public _clear(): void {
        this.preprocessUrlAsync = (url) => Promise.resolve(url);

        this.onMeshLoadedObservable.clear();
        this.onTextureLoadedObservable.clear();
        this.onMaterialLoadedObservable.clear();
        this.onCameraLoadedObservable.clear();
        this.onCompleteObservable.clear();
        this.onExtensionLoadedObservable.clear();
    }

    /**
     * The callback called when loading from a url.
     * @param scene scene loading this url
     * @param url url to load
     * @param onSuccess callback called when the file successfully loads
     * @param onProgress callback called while file is loading (if the server supports this mode)
     * @param useArrayBuffer defines a boolean indicating that date must be returned as ArrayBuffer
     * @param onError callback called when the file fails to load
     * @returns a file request object
     */
    public requestFile(scene: Scene, url: string, onSuccess: (data: any, request?: WebRequest) => void, onProgress?: (ev: ProgressEvent) => void, useArrayBuffer?: boolean, onError?: (error: any) => void): IFileRequest {
        if (useArrayBuffer) {
            if (this.useRangeRequests) {
                if (this.validate) {
                    Logger.Warn("glTF validation is not supported when range requests are enabled");
                }

                const fileRequests = new Array<IFileRequest>();
                const aggregatedFileRequest: IFileRequest = {
                    abort: () => fileRequests.forEach((fileRequest) => fileRequest.abort()),
                    onCompleteObservable: new Observable<IFileRequest>()
                };

                const dataBuffer = {
                    readAsync: (byteOffset: number, byteLength: number) => {
                        return new Promise<ArrayBufferView>((resolve, reject) => {
                            fileRequests.push(scene._requestFile(url, (data, webRequest) => {
                                dataBuffer.byteLength = Number(webRequest!.getResponseHeader("Content-Range")!.split("/")[1]);
                                resolve(new Uint8Array(data as ArrayBuffer));
                            }, onProgress, true, true, (error) => {
                                reject(error);
                            }, (webRequest) => {
                                webRequest.setRequestHeader("Range", `bytes=${byteOffset}-${byteOffset + byteLength - 1}`);
                            }));
                        });
                    },
                    byteLength: 0
                };

                this._unpackBinaryAsync(new DataReader(dataBuffer)).then((loaderData) => {
                    aggregatedFileRequest.onCompleteObservable.notifyObservers(aggregatedFileRequest);
                    onSuccess(loaderData);
                }, onError);

                return aggregatedFileRequest;
            }

            return scene._requestFile(url, (data, request) => {
                const arrayBuffer = data as ArrayBuffer;
                this._unpackBinaryAsync(new DataReader({
                    readAsync: (byteOffset, byteLength) => Promise.resolve(new Uint8Array(arrayBuffer, byteOffset, byteLength)),
                    byteLength: arrayBuffer.byteLength
                })).then((loaderData) => {
                     onSuccess(loaderData, request);
                }, onError);
            }, onProgress, true, true, onError);
        }

        return scene._requestFile(url, (data, response) => {
            this._validateAsync(scene, data, Tools.GetFolderPath(url), Tools.GetFilename(url));
            onSuccess({ json: this._parseJson(data as string) }, response);
        }, onProgress, true, false, onError);
    }

    /**
     * The callback called when loading from a file object.
     * @param scene scene loading this file
     * @param file defines the file to load
     * @param onSuccess defines the callback to call when data is loaded
     * @param onProgress defines the callback to call during loading process
     * @param useArrayBuffer defines a boolean indicating that data must be returned as an ArrayBuffer
     * @param onError defines the callback to call when an error occurs
     * @returns a file request object
     */
    public readFile(scene: Scene, file: File, onSuccess: (data: any) => void, onProgress?: (ev: ProgressEvent) => any, useArrayBuffer?: boolean, onError?: (error: any) => void): IFileRequest {
        return scene._readFile(file, (data) => {
            this._validateAsync(scene, data, "file:", file.name);
            if (useArrayBuffer) {
                const arrayBuffer = data as ArrayBuffer;
                this._unpackBinaryAsync(new DataReader({
                    readAsync: (byteOffset, byteLength) => Promise.resolve(new Uint8Array(arrayBuffer, byteOffset, byteLength)),
                    byteLength: arrayBuffer.byteLength
                })).then(onSuccess, onError);
            }
            else {
                onSuccess({ json: this._parseJson(data as string) });
            }
        }, onProgress, useArrayBuffer, onError);
    }

    /**
     * Imports one or more meshes from the loaded glTF data and adds them to the scene
     * @param meshesNames a string or array of strings of the mesh names that should be loaded from the file
     * @param scene the scene the meshes should be added to
     * @param data the glTF data to load
     * @param rootUrl root url to load from
     * @param onProgress event that fires when loading progress has occured
     * @param fileName Defines the name of the file to load
     * @returns a promise containg the loaded meshes, particles, skeletons and animations
     */
    public importMeshAsync(meshesNames: any, scene: Scene, data: any, rootUrl: string, onProgress?: (event: SceneLoaderProgressEvent) => void, fileName?: string): Promise<{ meshes: AbstractMesh[], particleSystems: IParticleSystem[], skeletons: Skeleton[], animationGroups: AnimationGroup[] }> {
        this.onParsedObservable.notifyObservers(data);
        this.onParsedObservable.clear();

        this._log(`Loading ${fileName || ""}`);
        this._loader = this._getLoader(data);
        return this._loader.importMeshAsync(meshesNames, scene, data, rootUrl, onProgress, fileName);
    }

    /**
     * Imports all objects from the loaded glTF data and adds them to the scene
     * @param scene the scene the objects should be added to
     * @param data the glTF data to load
     * @param rootUrl root url to load from
     * @param onProgress event that fires when loading progress has occured
     * @param fileName Defines the name of the file to load
     * @returns a promise which completes when objects have been loaded to the scene
     */
    public loadAsync(scene: Scene, data: any, rootUrl: string, onProgress?: (event: SceneLoaderProgressEvent) => void, fileName?: string): Promise<void> {
        this.onParsedObservable.notifyObservers(data);
        this.onParsedObservable.clear();

        this._log(`Loading ${fileName || ""}`);
        this._loader = this._getLoader(data);
        return this._loader.loadAsync(scene, data, rootUrl, onProgress, fileName);
    }

    /**
     * Load into an asset container.
     * @param scene The scene to load into
     * @param data The data to import
     * @param rootUrl The root url for scene and resources
     * @param onProgress The callback when the load progresses
     * @param fileName Defines the name of the file to load
     * @returns The loaded asset container
     */
    public loadAssetContainerAsync(scene: Scene, data: any, rootUrl: string, onProgress?: (event: SceneLoaderProgressEvent) => void, fileName?: string): Promise<AssetContainer> {
        this._log(`Loading ${fileName || ""}`);
        this._loader = this._getLoader(data);

        // Get materials/textures when loading to add to container
        const materials: Array<Material> = [];
        this.onMaterialLoadedObservable.add((material) => {
            materials.push(material);
        });
        const textures: Array<BaseTexture> = [];
        this.onTextureLoadedObservable.add((texture) => {
            textures.push(texture);
        });

        return this._loader.importMeshAsync(null, scene, data, rootUrl, onProgress, fileName).then((result) => {
            const container = new AssetContainer(scene);
            Array.prototype.push.apply(container.meshes, result.meshes);
            Array.prototype.push.apply(container.particleSystems, result.particleSystems);
            Array.prototype.push.apply(container.skeletons, result.skeletons);
            Array.prototype.push.apply(container.animationGroups, result.animationGroups);
            Array.prototype.push.apply(container.materials, materials);
            Array.prototype.push.apply(container.textures, textures);
            container.removeAllFromScene();
            return container;
        });
    }

    /**
     * The callback that returns true if the data can be directly loaded.
     * @param data string containing the file data
     * @returns if the data can be loaded directly
     */
    public canDirectLoad(data: string): boolean {
        return data.indexOf("asset") !== -1 && data.indexOf("version") !== -1;
    }

    /**
     * The callback that returns the data to pass to the plugin if the data can be directly loaded.
     * @param scene scene loading this data
     * @param data string containing the data
     * @returns data to pass to the plugin
     */
    public directLoad(scene: Scene, data: string): any {
        this._validateAsync(scene, data);
        return { json: this._parseJson(data) };
    }

    /**
     * The callback that allows custom handling of the root url based on the response url.
     * @param rootUrl the original root url
     * @param responseURL the response url if available
     * @returns the new root url
     */
    public rewriteRootURL?(rootUrl: string, responseURL?: string): string;

    /**
     * Instantiates a glTF file loader plugin.
     * @returns the created plugin
     */
    public createPlugin(): ISceneLoaderPlugin | ISceneLoaderPluginAsync {
        return new GLTFFileLoader();
    }

    /**
     * The loader state or null if the loader is not active.
     */
    public get loaderState(): Nullable<GLTFLoaderState> {
        return this._loader ? this._loader.state : null;
    }

    /**
     * Returns a promise that resolves when the asset is completely loaded.
     * @returns a promise that resolves when the asset is completely loaded.
     */
    public whenCompleteAsync(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.onCompleteObservable.addOnce(() => {
                resolve();
            });
            this.onErrorObservable.addOnce((reason) => {
                reject(reason);
            });
        });
    }

    private _validateAsync(scene: Scene, data: string | ArrayBuffer, rootUrl = "", fileName?: string): Promise<void> {
        if (!this.validate || typeof GLTFValidator === "undefined") {
            return Promise.resolve();
        }

        this._startPerformanceCounter("Validate JSON");

        const options: GLTF2.IGLTFValidationOptions = {
            externalResourceFunction: (uri) => {
                return this.preprocessUrlAsync(rootUrl + uri)
                    .then((url) => scene._loadFileAsync(url, undefined, true, true))
                    .then((data) => new Uint8Array(data as ArrayBuffer));
            }
        };

        if (fileName) {
            options.uri = (rootUrl === "file:" ? fileName : rootUrl + fileName);
        }

        const promise = (data instanceof ArrayBuffer)
            ? GLTFValidator.validateBytes(new Uint8Array(data), options)
            : GLTFValidator.validateString(data, options);

        return promise.then((result) => {
            this._endPerformanceCounter("Validate JSON");
            this.onValidatedObservable.notifyObservers(result);
            this.onValidatedObservable.clear();
        }, (reason) => {
            this._endPerformanceCounter("Validate JSON");
            Tools.Warn(`Failed to validate: ${reason}`);
            this.onValidatedObservable.clear();
        });
    }

    private _getLoader(loaderData: IGLTFLoaderData): IGLTFLoader {
        const asset = (<any>loaderData.json).asset || {};

        this._log(`Asset version: ${asset.version}`);
        asset.minVersion && this._log(`Asset minimum version: ${asset.minVersion}`);
        asset.generator && this._log(`Asset generator: ${asset.generator}`);

        const version = GLTFFileLoader._parseVersion(asset.version);
        if (!version) {
            throw new Error("Invalid version: " + asset.version);
        }

        if (asset.minVersion !== undefined) {
            const minVersion = GLTFFileLoader._parseVersion(asset.minVersion);
            if (!minVersion) {
                throw new Error("Invalid minimum version: " + asset.minVersion);
            }

            if (GLTFFileLoader._compareVersion(minVersion, { major: 2, minor: 0 }) > 0) {
                throw new Error("Incompatible minimum version: " + asset.minVersion);
            }
        }

        const createLoaders: { [key: number]: (parent: GLTFFileLoader) => IGLTFLoader } = {
            1: GLTFFileLoader._CreateGLTF1Loader,
            2: GLTFFileLoader._CreateGLTF2Loader
        };

        const createLoader = createLoaders[version.major];
        if (!createLoader) {
            throw new Error("Unsupported version: " + asset.version);
        }

        return createLoader(this);
    }

    private _parseJson(json: string): Object {
        this._startPerformanceCounter("Parse JSON");
        this._log(`JSON length: ${json.length}`);
        const parsed = JSON.parse(json);
        this._endPerformanceCounter("Parse JSON");
        return parsed;
    }

    private _unpackBinaryAsync(dataReader: DataReader): Promise<IGLTFLoaderData> {
        this._startPerformanceCounter("Unpack Binary");

        // Read magic + version + length + json length + json format
        return dataReader.loadAsync(20).then(() => {
            const Binary = {
                Magic: 0x46546C67
            };

            const magic = dataReader.readUint32();
            if (magic !== Binary.Magic) {
                throw new Error("Unexpected magic: " + magic);
            }

            const version = dataReader.readUint32();

            if (this.loggingEnabled) {
                this._log(`Binary version: ${version}`);
            }

            const length = dataReader.readUint32();
            if (length !== dataReader.buffer.byteLength) {
                throw new Error(`Length in header does not match actual data length: ${length} != ${dataReader.buffer.byteLength}`);
            }

            let unpacked: Promise<IGLTFLoaderData>;
            switch (version) {
                case 1: {
                    unpacked = this._unpackBinaryV1Async(dataReader);
                    break;
                }
                case 2: {
                    unpacked = this._unpackBinaryV2Async(dataReader);
                    break;
                }
                default: {
                    throw new Error("Unsupported version: " + version);
                }
            }

            this._endPerformanceCounter("Unpack Binary");

            return unpacked;
        });
    }

    private _unpackBinaryV1Async(dataReader: DataReader): Promise<IGLTFLoaderData> {
        const ContentFormat = {
            JSON: 0
        };

        const contentLength = dataReader.readUint32();
        const contentFormat = dataReader.readUint32();

        if (contentFormat !== ContentFormat.JSON) {
            throw new Error(`Unexpected content format: ${contentFormat}`);
        }

        const bodyLength = dataReader.buffer.byteLength - dataReader.byteOffset;

        const data: IGLTFLoaderData = { json: this._parseJson(dataReader.readString(contentLength)), bin: null };
        if (bodyLength !== 0) {
            const startByteOffset = dataReader.byteOffset;
            data.bin = {
                readAsync: (byteOffset, byteLength) => dataReader.buffer.readAsync(startByteOffset + byteOffset, byteLength),
                byteLength: bodyLength
            };
        }

        return Promise.resolve(data);
    }

    private _unpackBinaryV2Async(dataReader: DataReader): Promise<IGLTFLoaderData> {
        const ChunkFormat = {
            JSON: 0x4E4F534A,
            BIN: 0x004E4942
        };

        // Read the JSON chunk header.
        const chunkLength = dataReader.readUint32();
        const chunkFormat = dataReader.readUint32();
        if (chunkFormat !== ChunkFormat.JSON) {
            throw new Error("First chunk format is not JSON");
        }

        // Bail if there are no other chunks.
        if (dataReader.byteOffset + chunkLength === dataReader.buffer.byteLength) {
            return dataReader.loadAsync(chunkLength).then(() => {
                return { json: this._parseJson(dataReader.readString(chunkLength)), bin: null };
            });
        }

        // Read the JSON chunk and the length and type of the next chunk.
        return dataReader.loadAsync(chunkLength + 8).then(() => {
            const data: IGLTFLoaderData = { json: this._parseJson(dataReader.readString(chunkLength)), bin: null };

            const readAsync = (): Promise<IGLTFLoaderData> => {
                const chunkLength = dataReader.readUint32();
                const chunkFormat = dataReader.readUint32();

                switch (chunkFormat) {
                    case ChunkFormat.JSON: {
                        throw new Error("Unexpected JSON chunk");
                    }
                    case ChunkFormat.BIN: {
                        const startByteOffset = dataReader.byteOffset;
                        data.bin = {
                            readAsync: (byteOffset, byteLength) => dataReader.buffer.readAsync(startByteOffset + byteOffset, byteLength),
                            byteLength: chunkLength
                        };
                        dataReader.skipBytes(chunkLength);
                        break;
                    }
                    default: {
                        // ignore unrecognized chunkFormat
                        dataReader.skipBytes(chunkLength);
                        break;
                    }
                }

                if (dataReader.byteOffset !== dataReader.buffer.byteLength) {
                    return dataReader.loadAsync(8).then(readAsync);
                }

                return Promise.resolve(data);
            };

            return readAsync();
        });
    }

    private static _parseVersion(version: string): Nullable<{ major: number, minor: number }> {
        if (version === "1.0" || version === "1.0.1") {
            return {
                major: 1,
                minor: 0
            };
        }

        const match = (version + "").match(/^(\d+)\.(\d+)/);
        if (!match) {
            return null;
        }

        return {
            major: parseInt(match[1]),
            minor: parseInt(match[2])
        };
    }

    private static _compareVersion(a: { major: number, minor: number }, b: { major: number, minor: number }): number {
        if (a.major > b.major) { return 1; }
        if (a.major < b.major) { return -1; }
        if (a.minor > b.minor) { return 1; }
        if (a.minor < b.minor) { return -1; }
        return 0;
    }

    private static readonly _logSpaces = "                                ";
    private _logIndentLevel = 0;
    private _loggingEnabled = false;

    /** @hidden */
    public _log = this._logDisabled;

    /** @hidden */
    public _logOpen(message: string): void {
        this._log(message);
        this._logIndentLevel++;
    }

    /** @hidden */
    public _logClose(): void {
        --this._logIndentLevel;
    }

    private _logEnabled(message: string): void {
        const spaces = GLTFFileLoader._logSpaces.substr(0, this._logIndentLevel * 2);
        Logger.Log(`${spaces}${message}`);
    }

    private _logDisabled(message: string): void {
    }

    private _capturePerformanceCounters = false;

    /** @hidden */
    public _startPerformanceCounter = this._startPerformanceCounterDisabled;

    /** @hidden */
    public _endPerformanceCounter = this._endPerformanceCounterDisabled;

    private _startPerformanceCounterEnabled(counterName: string): void {
        Tools.StartPerformanceCounter(counterName);
    }

    private _startPerformanceCounterDisabled(counterName: string): void {
    }

    private _endPerformanceCounterEnabled(counterName: string): void {
        Tools.EndPerformanceCounter(counterName);
    }

    private _endPerformanceCounterDisabled(counterName: string): void {
    }
}

if (SceneLoader) {
    SceneLoader.RegisterPlugin(new GLTFFileLoader());
}
