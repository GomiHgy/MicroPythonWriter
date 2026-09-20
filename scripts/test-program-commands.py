"""Writer生成コマンドを一時領域で実行するホスト検証。実機や既存ファイルは操作しない。"""
import builtins
import contextlib
import gc
import io
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tempfile
import traceback
import types


def simulate(request):
    with tempfile.TemporaryDirectory(prefix="mpw-program-commands-") as directory:
        root = Path(directory).resolve()
        known_paths = set()
        compilations = []
        reads = []
        opened = []
        collections = []
        original_compile = builtins.compile
        original_import = builtins.__import__
        originals = [source for source in request.get("files", {}).values() if source]

        def local_path(value):
            virtual = PurePosixPath(str(value).replace("\\", "/"))
            parts = [part for part in virtual.parts if part != "/"]
            if any(part in ("..", ".") or ":" in part for part in parts):
                raise ValueError("Only isolated virtual paths are supported")
            resolved = root.joinpath(*parts).resolve()
            if not resolved.is_relative_to(root):
                raise ValueError("Path escapes the test directory")
            known_paths.add(str(value))
            return resolved

        def write_file(path, source):
            target = local_path(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.encode("utf-8"))

        class TrackedFile:
            def __init__(self, path, mode, *args, **kwargs):
                self.path = str(path)
                self.file = builtins.open(local_path(path), mode, *args, **kwargs)
                opened.append(self)

            def read(self, size=-1):
                reads.append({"path": self.path, "size": size})
                return self.file.read(size)

            def __enter__(self):
                self.file.__enter__()
                return self

            def __exit__(self, *args):
                return self.file.__exit__(*args)

            def __getattr__(self, name):
                return getattr(self.file, name)

        def tracked_compile(source, filename, mode, *args, **kwargs):
            compilations.append({"filename": filename, "mode": mode})
            return original_compile(source, filename, mode, *args, **kwargs)

        def tracked_collect():
            collections.append(True)
            return gc.collect()

        virtual_os = types.SimpleNamespace(
            stat=lambda path: os.stat(local_path(path)),
            remove=lambda path: os.remove(local_path(path)),
            rename=lambda source, target: os.rename(local_path(source), local_path(target)),
            sync=lambda: None,
        )

        def tracked_import(name, *args, **kwargs):
            if name == "os":
                return virtual_os
            if name == "gc":
                return types.SimpleNamespace(collect=tracked_collect)
            return original_import(name, *args, **kwargs)

        simulated_builtins = dict(vars(builtins))
        simulated_builtins.update(open=TrackedFile, compile=tracked_compile,
                                  __import__=tracked_import)

        def fresh_scope():
            return {"__name__": "__main__", "__builtins__": simulated_builtins}

        def source_references(scope):
            matches = []
            seen = set()

            def inspect(value, name):
                if isinstance(value, (str, bytes)):
                    if any(value == source or value == source.encode("utf-8")
                           for source in originals):
                        matches.append(name)
                elif isinstance(value, (dict, tuple, list)) and id(value) not in seen:
                    seen.add(id(value))
                    entries = value.items() if isinstance(value, dict) else enumerate(value)
                    for key, nested in entries:
                        if key != "__builtins__":
                            inspect(nested, "%s.%s" % (name, key))

            for name, value in scope.items():
                if name != "__builtins__":
                    inspect(value, name)
            return matches

        for path, source in request.get("files", {}).items():
            write_file(path, source)
        scope = fresh_scope()
        steps = []
        for index, action in enumerate(request["actions"]):
            output = io.StringIO()
            error = None
            read_start = len(reads)
            collection_start = len(collections)
            try:
                with contextlib.redirect_stdout(output):
                    if "command" in action:
                        # コマンド自身の構文解析は、作品コードのcompile回数に含めない。
                        command = original_compile(action["command"], "<writer-command-%d>" % index, "exec")
                        exec(command, scope)
                    elif "write" in action:
                        write_file(action["write"]["path"], action["write"]["source"])
                    elif "copy" in action:
                        source = local_path(action["copy"]["from"])
                        destination = local_path(action["copy"]["to"])
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_bytes(source.read_bytes())
                    elif "remove" in action:
                        local_path(action["remove"]).unlink()
                    elif action.get("reset"):
                        scope = fresh_scope()
                    else:
                        raise ValueError("Unknown host test action")
            except BaseException as caught:
                error = {"type": type(caught).__name__, "message": str(caught),
                         "traceback": traceback.format_exc()}
            prepared = scope.get("_mpw_prepared")
            steps.append({
                "stdout": output.getvalue(), "error": error,
                "compileCount": len(compilations),
                "globalKeys": sorted(name for name in scope if name != "__builtins__"),
                "sourceReferences": source_references(scope),
                "cachePresent": prepared is not None,
                "cacheToken": prepared[0] if isinstance(prepared, tuple) else None,
                "reads": reads[read_start:],
                "collections": len(collections) - collection_start,
                "openFiles": [file.path for file in opened if not file.closed],
            })
            # 観測自体が前回cacheへの余計な参照を残さないようにする。
            prepared = None
        files = {path: local_path(path).read_text(encoding="utf-8")
                 for path in sorted(known_paths) if local_path(path).is_file()}
        return {"steps": steps, "compilations": compilations, "files": files}


if __name__ == "__main__":
    print(json.dumps(simulate(json.load(sys.stdin)), ensure_ascii=True))
