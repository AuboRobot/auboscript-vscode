"""Check the shipped Python API declarations without installing the SDK."""

import ast
import builtins
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
STUB = ROOT / "api/python/pyaubo_sdk/__init__.pyi"
EXPECTED_CLASSES = set("""
AuboApi AuboErrorCodes AuboException CircleParameters ConveyorCalibResult
ForceControl ForceControlState GripperInterface HandleModeType HandleStateType
InputParser IoControl JointServoModeType JointStateType Math MotionControl
OperationalModeType OutputBuilder RefFrameType RegisterControl RobotAlgorithm
RobotConfig RobotControlModeType RobotIOType RobotInterface RobotManage
RobotModeType RobotMsg RobotSafetyParameterRange RobotState RpcClient RtdeClient
RtdeRecipe RuntimeMachine RuntimeState SafetyCubic SafetyInputAction SafetyModeType
SafetyOutputRunState SafetyParams ScriptClient ScriptWriter Serial Socket
SpiralParameters StandardInputAction StandardOutputRunState SyncMove SystemInfo
TaskFrameType Trace TraceLevel TriggerPlane Vector3f Vector4f Vector6f
VibrationRecalibrationParameter WorldZone WorldZoneState
""".split())


class PythonStubTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = STUB.read_text(encoding="utf-8")
        cls.tree = ast.parse(cls.source)
        cls.classes = {
            node.name: node for node in cls.tree.body if isinstance(node, ast.ClassDef)
        }
        cls.manifest = json.loads((ROOT / "api/python/manifest.json").read_text())

    def methods(self, name, method):
        return [
            node for node in self.classes[name].body
            if isinstance(node, ast.FunctionDef) and node.name == method
        ]

    def test_runtime_surface_and_version(self):
        self.assertEqual(set(self.classes), EXPECTED_CLASSES)
        self.assertEqual(self.manifest["sdkVersion"], "0.27.1-rc.4")
        self.assertEqual(self.manifest["coverage"]["classes"], len(self.classes))
        self.assertEqual(
            {node.name for node in self.tree.body if isinstance(node, ast.FunctionDef)},
            {"errorCode2Str", "returnValue2Str"},
        )

    def test_real_robot_handle_chain(self):
        self.assertEqual(ast.unparse(self.classes["RpcClient"].bases[0]), "AuboApi")
        for owner, method, result in [
            ("AuboApi", "getRobotInterface", "RobotInterface"),
            ("RobotInterface", "getMotionControl", "MotionControl"),
            ("RobotInterface", "getRobotConfig", "RobotConfig"),
            ("RobotInterface", "getRobotState", "RobotState"),
            ("RobotInterface", "getSyncMove", "SyncMove"),
        ]:
            self.assertEqual(ast.unparse(self.methods(owner, method)[0].returns), result)
        move = self.methods("MotionControl", "moveJoint")[0]
        args = move.args.posonlyargs + move.args.args
        self.assertEqual([ast.unparse(a.annotation) for a in args[1:]],
                         ["list[float]", "float", "float", "float", "float"])
        self.assertEqual(ast.unparse(move.returns), "int")
        self.assertEqual(len(move.args.posonlyargs), 6)

    def test_constructors_defaults_and_overloads(self):
        rpc_init = self.methods("RpcClient", "__init__")[0]
        self.assertEqual(len(rpc_init.args.posonlyargs + rpc_init.args.args), 1)
        spiral = self.methods("SpiralParameters", "__init__")
        self.assertEqual(len(spiral), 2)
        named = max(spiral, key=lambda method: len(method.args.args))
        self.assertEqual([arg.arg for arg in named.args.args[1:]],
                         ["frame", "plane", "angle", "spiral", "helix"])
        self.assertEqual(len(named.args.defaults), 5)
        push = self.methods("OutputBuilder", "push")
        self.assertEqual(len(push), 5)
        self.assertEqual(len({ast.unparse((node.args.posonlyargs + node.args.args)[1].annotation)
                              for node in push}), 5)
        self.assertTrue(all("typing.overload" in [ast.unparse(d) for d in n.decorator_list]
                            for n in push))

    def test_properties_and_fixed_arrays(self):
        recipe = self.classes["RtdeRecipe"]
        properties = {n.target.id: ast.unparse(n.annotation) for n in recipe.body
                      if isinstance(n, ast.AnnAssign)}
        self.assertEqual(properties["frequency"], "float")
        self.assertEqual(properties["segments"], "list[str]")
        error_code = self.methods("ConveyorCalibResult", "error_code")[0]
        self.assertIn("property", [ast.unparse(d) for d in error_code.decorator_list])
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Subscript):
                self.assertFalse(isinstance(node.slice, ast.Constant)
                                 and isinstance(node.slice.value, int),
                                 "C++ array sizes must not become Python type arguments")
            if isinstance(node, ast.arg) and node.arg == "self":
                self.assertIsNone(node.annotation)

    def test_no_invented_api_or_unresolved_types(self):
        defined = set(dir(builtins)) | set(self.classes) | {"typing", "property"}
        for node in ast.walk(self.tree):
            annotations = []
            if isinstance(node, (ast.arg, ast.AnnAssign)) and node.annotation:
                annotations.append(node.annotation)
            if isinstance(node, ast.FunctionDef) and node.returns:
                annotations.append(node.returns)
            for annotation in annotations:
                for name in ast.walk(annotation):
                    if isinstance(name, ast.Name):
                        self.assertIn(name.id, defined)
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                self.assertNotEqual(node.target.id, "None_")
            if isinstance(node, ast.FunctionDef):
                self.assertTrue(any(isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                                    and n.value.value is Ellipsis for n in node.body),
                            'stub functions must have an ellipsis body')
                self.assertFalse(any(a.arg.startswith("arg") and a.arg[3:].isdigit()
                                     for a in node.args.args),
                                 "Unnamed pybind arguments must be positional-only")
        for private_marker in ["common_interface", "aubo_script", "/root/", "arcs::"]:
            self.assertNotIn(private_marker, self.source)


if __name__ == "__main__":
    unittest.main()
