import Quill from "quill";
import EditorEvents from "../editor-events";
const Parchment = Quill.import("parchment");

class History {
    constructor(quill, options) {
        this.quill = quill;
        this.options = options;
        this.editor = null;
    }

    init(editor) {

        this.lastRecorded = 0;
        this.clear();

        if(!this.editor) {
            this.editor = editor;
            this.editor.on(EditorEvents.editorTextChanged, ({delta, oldDelta}) => {
                let self = this;
                // Wait for local fixing delta to be applied in this cycle before get quill content in record function.
                setTimeout(() => {
                    self.record(delta, oldDelta);
                }, 1);
            });

            this.quill.keyboard.addBinding({ key: 'Z', shortKey: true }, this.undo.bind(this));
            this.quill.keyboard.addBinding({ key: 'Z', shortKey: true, shiftKey: true }, this.redo.bind(this));
            if (/Win/i.test(navigator.platform)) {
                this.quill.keyboard.addBinding({ key: 'Y', shortKey: true }, this.redo.bind(this));
            }
        }
    }

    change(source, dest) {
        if (this.stack[source].length === 0) return;
        let delta = this.stack[source].pop();
        this.stack[dest].push(delta);
        this.lastRecorded = 0;

        let oldDelta = this.quill.getContents();

        this.editor.composition.submitLocalFixingDelta(delta[source]);
        this.editor.synchronizer.submitDeltaToUpstream(delta[source]);

        let index = getLastChangeIndex(delta[source]);
        this.quill.setSelection(index);

        // trigger events
        this.editor.dispatchEvent(source, {delta: delta[source], oldDelta: oldDelta});
    }

    clear() {
        this.stack = { undo: [], redo: [] };
    }

    cutoff() {
        this.lastRecorded = 0;
    }

    record(changeDelta, oldDelta) {

        console.log("change delta: " + JSON.stringify(changeDelta.ops));
        console.log("old delta: " + JSON.stringify(oldDelta.ops));

        if (changeDelta.ops.length === 0) return;
        this.stack.redo = [];
        let undoDelta = this.quill.getContents().diff(oldDelta);
        let timestamp = Date.now();
        if (this.lastRecorded + this.options.delay > timestamp && this.stack.undo.length > 0) {
            let delta = this.stack.undo.pop();
            undoDelta = undoDelta.compose(delta.undo);
            changeDelta = delta.redo.compose(changeDelta);
        } else {
            this.lastRecorded = timestamp;
        }
        this.stack.undo.push({
            redo: changeDelta,
            undo: undoDelta
        });
        if (this.stack.undo.length > this.options.maxStack) {
            this.stack.undo.shift();
        }

        console.log(this.stack);
    }

    redo() {
        this.change('redo', 'undo');
    }

    transform(delta) {
        this.stack.undo.forEach(function(change) {
            change.undo = delta.transform(change.undo, true);
            change.redo = delta.transform(change.redo, true);
        });
        this.stack.redo.forEach(function(change) {
            change.undo = delta.transform(change.undo, true);
            change.redo = delta.transform(change.redo, true);
        });
    }

    undo() {
        this.change('undo', 'redo');
    }
}
History.DEFAULTS = {
    delay: 1000,
    maxStack: 100
};

function endsWithNewlineChange(delta) {
    let lastOp = delta.ops[delta.ops.length - 1];
    if (lastOp == null) return false;
    if (lastOp.insert != null) {
        return typeof lastOp.insert === 'string' && lastOp.insert.endsWith('\n');
    }
    if (lastOp.attributes != null) {
        return Object.keys(lastOp.attributes).some(function(attr) {
            return Parchment.query(attr, Parchment.Scope.BLOCK) != null;
        });
    }
    return false;
}

function getLastChangeIndex(delta) {
    let deleteLength = delta.reduce(function(length, op) {
        length += (op.delete || 0);
        return length;
    }, 0);
    let changeIndex = delta.length() - deleteLength;
    if (endsWithNewlineChange(delta)) {
        changeIndex -= 1;
    }
    return changeIndex;
}


export { History as default, getLastChangeIndex };
