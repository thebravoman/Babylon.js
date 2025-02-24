import { Quaternion } from '../../Maths/math.vector';
import { WindowsMotionController } from '../../Gamepads/Controllers/windowsMotionController';
import { OculusTouchController } from '../../Gamepads/Controllers/oculusTouchController';
import { WebXRInput } from './webXRInput';
import { ViveController } from '../../Gamepads/Controllers/viveController';
import { WebVRController } from '../../Gamepads/Controllers/webVRController';

/**
 * Loads a controller model and adds it as a child of the WebXRControllers grip when the controller is created
 */
export class WebXRControllerModelLoader {
    /**
     * Creates the WebXRControllerModelLoader
     * @param input xr input that creates the controllers
     */
    constructor(input: WebXRInput) {
        input.onControllerAddedObservable.add((c) => {
            let controllerModel: WebVRController;
            if (c.inputSource.gamepad && c.inputSource.gamepad.id === "htc-vive") {
                controllerModel = new ViveController(c.inputSource.gamepad);
                controllerModel.hand = c.inputSource.handedness;
                controllerModel.isXR = true;
                controllerModel.initControllerMesh(c.getScene(), (m) => {
                    m.isPickable = false;
                    m.getChildMeshes(false).forEach((m) => {
                        m.isPickable = false;
                    });
                    controllerModel.mesh!.parent = c.grip!;
                    controllerModel.mesh!.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI, 0);
                });
            } else if (c.inputSource.gamepad && c.inputSource.gamepad.id === "oculus-touch") {
                controllerModel = new OculusTouchController(c.inputSource.gamepad);
                controllerModel.hand = c.inputSource.handedness;
                controllerModel.isXR = true;
                controllerModel.initControllerMesh(c.getScene(), (m) => {
                    controllerModel.mesh!.parent = c.grip!;
                    controllerModel.mesh!.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI, 0);
                    controllerModel.mesh!.position.y = 0.034;
                    controllerModel.mesh!.position.z = 0.052;
                });
            } else if (c.inputSource.gamepad && c.inputSource.gamepad.id === "oculus-quest") {
                OculusTouchController._IsQuest = true;
                controllerModel = new OculusTouchController(c.inputSource.gamepad);
                controllerModel.hand = c.inputSource.handedness;
                controllerModel.isXR = true;
                controllerModel.initControllerMesh(c.getScene(), (m) => {
                    controllerModel.mesh!.parent = c.grip!;
                    controllerModel.mesh!.rotationQuaternion = Quaternion.FromEulerAngles(Math.PI / -4, Math.PI, 0);
                });
            } else {
                controllerModel = new WindowsMotionController(c.inputSource.gamepad);
                controllerModel.hand = c.inputSource.handedness;
                controllerModel.isXR = true;
                controllerModel.initControllerMesh(c.getScene(), (m) => {
                    controllerModel.mesh!.parent = c.grip!;
                    controllerModel.mesh!.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI, 0);
                });
            }
            c.gamepadController = controllerModel;
        });
    }
}