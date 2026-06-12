'use strict';
// controllers/codeRunner.controller.js
// Module: Code Execution — universal param matching via Judge0 CE

const axios = require('axios');

const JUDGE0_URL  = process.env.JUDGE0_URL || 'https://ce.judge0.com';
const JUDGE0_KEY  = process.env.JUDGE0_KEY || '';
const MAX_WAIT_MS = 12_000;
const POLL_MS     = 800;

const LANG_IDS = {
  javascript: 63, // Node.js 12.14.0
  python:     71, // Python 3.8.1
  java:       62, // Java OpenJDK 13.0.1
  cpp:        54, // C++ GCC 9.2.0
  typescript: 74, // TypeScript 3.7.4
};

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PARAM MATCHING STRATEGY
//
//  For every language, bind function parameters to injected values via:
//  1. Exact name match   — fn(nums, target) + { nums, target }
//  2. Fuzzy name match   — fn(grid, n) + { matrice, n } → "grid" fuzzy-matches "matrice"
//  3. Positional fallback — fn(a, b) + { x, y } → a=x, b=y
// ─────────────────────────────────────────────────────────────────────────────

function _resolveArgs(paramNames, injectedNames, injectedValues) {
  const nameToValue = Object.fromEntries(injectedNames.map((n, i) => [n, injectedValues[i]]));

  return paramNames.map((pName, i) => {
    if (pName in nameToValue) return nameToValue[pName]; // exact
    const fuzzy = injectedNames.find(
      n => n.toLowerCase().includes(pName.toLowerCase()) ||
           pName.toLowerCase().includes(n.toLowerCase())
    );
    if (fuzzy) return nameToValue[fuzzy]; // fuzzy
    return injectedValues[i] !== undefined ? injectedValues[i] : null; // positional
  });
}

// ── Language source builders ──────────────────────────────────────────────────

function _buildJavaScript(userCode, entries, injectedNames, injectedValues) {
  const injections = entries.map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n');

  return `
${injections}

${userCode}

(function _autoRun() {
  const _RESERVED = new Set([
    'require','module','exports','process','console','setTimeout','setInterval',
    'clearTimeout','clearInterval','Buffer','Promise','Math','JSON','Object',
    'Array','String','Number','Boolean','Error','Map','Set','Symbol','RegExp',
    'Date','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent',
    'decodeURIComponent','__dirname','__filename','global','globalThis','_autoRun',
  ]);

  const _g   = (typeof globalThis !== 'undefined' ? globalThis : global);
  const _fns = Object.keys(_g).filter(k => !_RESERVED.has(k) && typeof _g[k] === 'function');
  if (!_fns.length) { process.stderr.write('No function found.\\n'); process.exit(1); }

  const _fn  = _g[_fns[_fns.length - 1]];
  const _src = _fn.toString();
  const _pMatch = _src.match(/(?:function\\s*\\w*\\s*|=>\\s*)?\\(([^)]*)\\)/) ||
                  _src.match(/^(\\w+)\\s*=>/);
  const _paramNames = _pMatch
    ? _pMatch[1].split(',').map(s => s.trim().replace(/=.*$/, '').trim()).filter(Boolean)
    : [];

  const _injectedNames  = ${JSON.stringify(injectedNames)};
  const _injectedValues = ${JSON.stringify(injectedValues)};
  const _nameToValue = Object.fromEntries(_injectedNames.map((n, i) => [n, _injectedValues[i]]));

  const _arity = _fn.length || _paramNames.length;
  let _call = _paramNames.slice(0, _arity).map((pName, i) => {
    if (pName in _nameToValue) return _nameToValue[pName];
    const _fuzzy = _injectedNames.find(
      n => n.toLowerCase().includes(pName.toLowerCase()) || pName.toLowerCase().includes(n.toLowerCase())
    );
    if (_fuzzy) return _nameToValue[_fuzzy];
    return _injectedValues[i] !== undefined ? _injectedValues[i] : null;
  });
  if (!_call.length) _call = [..._injectedValues];

  try {
    const _result = _fn(..._call);
    if (_result && typeof _result.then === 'function') {
      _result.then(r => console.log(JSON.stringify(r)))
             .catch(e => { process.stderr.write(e.message + '\\n'); process.exit(1); });
    } else {
      console.log(JSON.stringify(_result));
    }
  } catch (e) {
    process.stderr.write('Runtime error: ' + e.message + '\\n');
    process.exit(1);
  }
})();
`;
}

function _buildPython(userCode, entries, injectedNames, injectedValues) {
  const injections = entries.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n');

  return `
import json as _json, sys as _sys, inspect as _inspect

${injections}

${userCode}

_RESERVED = {'json','sys','inspect','_json','_sys','_inspect','_RESERVED',
             '_injected_names','_injected_values','_name_to_value',
             '_fns','_fn_name','_fn','_params','_param_names','_arity','_call','_result'}

_injected_names  = ${JSON.stringify(injectedNames)}
_injected_values = ${JSON.stringify(injectedValues)}
_name_to_value   = { _injected_names[i]: _injected_values[i] for i in range(len(_injected_names)) }

_fns = [(k, v) for k, v in list(locals().items())
        if callable(v) and not k.startswith('_') and k not in _RESERVED]
if not _fns:
    _sys.stderr.write("No function found.\\n"); _sys.exit(1)

_fn_name, _fn = _fns[-1]
try: _param_names = list(_inspect.signature(_fn).parameters.keys())
except: _param_names = []

_call = []
for _i, _pname in enumerate(_param_names):
    if _pname in _name_to_value:
        _call.append(_name_to_value[_pname])
    else:
        _fuzzy = next((n for n in _injected_names
                       if n.lower() in _pname.lower() or _pname.lower() in n.lower()), None)
        _call.append(_name_to_value[_fuzzy] if _fuzzy else
                     (_injected_values[_i] if _i < len(_injected_values) else None))

if not len(_param_names): _call = _injected_values[:]

try:
    _result = _fn(*_call)
    print(_json.dumps(_result))
except Exception as _e:
    _sys.stderr.write(f"Runtime error ({_fn_name}): {_e}\\n"); _sys.exit(1)
`;
}

function _buildJava(userCode, entries, injectedNames, injectedValues) {
  const varDecls = entries.map(([k, v]) => {
    if (Array.isArray(v)) {
      if (v.length > 0 && Array.isArray(v[0])) {
        const flat = v.flat();
        if (flat.every(x => typeof x === 'string' && x.length === 1)) {
          const rows = v.map(row => `{${row.map(c => `'${c}'`).join(', ')}}`).join(', ');
          return `        char[][] ${k} = { ${rows} };`;
        }
        const rows = v.map(row => `{${row.join(', ')}}`).join(', ');
        return `        int[][] ${k} = { ${rows} };`;
      }
      if (v.every(x => typeof x === 'string'))  return `        String[] ${k} = { ${v.map(s => `"${s}"`).join(', ')} };`;
      if (v.every(x => Number.isInteger(x)))    return `        int[] ${k} = { ${v.join(', ')} };`;
      if (v.every(x => typeof x === 'number'))  return `        double[] ${k} = { ${v.join(', ')} };`;
      return `        Object[] ${k} = null;`;
    }
    if (Number.isInteger(v))    return `        int ${k} = ${v};`;
    if (typeof v === 'number')  return `        double ${k} = ${v};`;
    if (typeof v === 'string')  return `        String ${k} = ${JSON.stringify(v)};`;
    if (typeof v === 'boolean') return `        boolean ${k} = ${v};`;
    return `        Object ${k} = null;`;
  }).join('\n');

  const cleaned   = userCode.replace(/^import\s+.*?;\s*/gm, '').replace(/public\s+class\s+Main[\s\S]*$/, '').trim();
  const methodMatch = cleaned.match(/(?:public\s+)?(?:static\s+)?(?:\w[\w\[\]]*)\s+(\w+)\s*\(([^)]*)\)/);
  const methodName  = methodMatch?.[1] || null;

  let argList = injectedNames.join(', ');
  if (methodMatch?.[2]) {
    const javaParams = methodMatch[2].split(',').map(p => p.trim().split(/\s+/).pop()).filter(Boolean);
    argList = javaParams.map((pName, i) => {
      if (injectedNames.includes(pName)) return pName;
      const fuzzy = injectedNames.find(n => n.toLowerCase().includes(pName.toLowerCase()) || pName.toLowerCase().includes(n.toLowerCase()));
      return fuzzy || injectedNames[i] || 'null';
    }).join(', ');
  }

  const isStatic = methodName && cleaned.match(new RegExp(`static[^(]*${methodName}`));
  const callExpr = methodName
    ? (isStatic ? `Solution.${methodName}(${argList})` : `new Solution().${methodName}(${argList})`)
    : `new Solution().solve(${argList})`;

  return `
import java.util.*;
import java.util.Arrays;

${cleaned}

public class Main {
    public static void main(String[] args) {
${varDecls}
        try {
            Object _result = ${callExpr};
            if (_result instanceof int[][]) {
                int[][] _r = (int[][]) _result;
                StringBuilder _sb = new StringBuilder("[");
                for (int i = 0; i < _r.length; i++) { _sb.append(Arrays.toString(_r[i]).replace(", ",",")); if (i < _r.length-1) _sb.append(","); }
                System.out.println(_sb.append("]"));
            } else if (_result instanceof int[]) {
                int[] _r = (int[]) _result; StringBuilder _sb = new StringBuilder("[");
                for (int i = 0; i < _r.length; i++) { _sb.append(_r[i]); if (i < _r.length-1) _sb.append(","); }
                System.out.println(_sb.append("]"));
            } else if (_result instanceof List) {
                System.out.println(_result.toString().replace(", ",","));
            } else { System.out.println(_result); }
        } catch (Exception _e) { System.err.println("Runtime error: " + _e.getMessage()); System.exit(1); }
    }
}
`;
}

function _buildCpp(userCode, entries, injectedNames, injectedValues) {
  const cppDecls = entries.map(([k, v]) => {
    if (Array.isArray(v)) {
      if (v.length && Array.isArray(v[0])) {
        if (v[0].every(c => typeof c === 'string' && c.length === 1)) {
          return `    vector<vector<char>> ${k} = {${v.map(r => `{${r.map(c => `'${c}'`).join(',')}}`).join(',')}};`;
        }
        return `    vector<vector<int>> ${k} = {${v.map(r => `{${r.join(',')}}`).join(',')}};`;
      }
      if (v.every(x => typeof x === 'string')) return `    vector<string> ${k} = {${v.map(s => `"${s}"`).join(',')}};`;
      return `    vector<int> ${k} = {${v.join(',')}};`;
    }
    if (Number.isInteger(v))    return `    int ${k} = ${v};`;
    if (typeof v === 'number')  return `    double ${k} = ${v};`;
    if (typeof v === 'string')  return `    string ${k} = "${v}";`;
    if (typeof v === 'boolean') return `    bool ${k} = ${v};`;
    return `    // unsupported: ${k}`;
  }).join('\n');

  // FIX 1 : regex qui détecte vector<int>, vector<vector<int>>, etc.
  const fnMatch = userCode.match(
    /(?:vector\s*<[^>]+(?:<[^>]+>)?\s*>|int|long long|long|double|float|bool|string|void|auto)\s+(\w+)\s*\(([^)]*)\)/
  );

  let cppArgList = injectedNames.join(', ');
  if (fnMatch?.[2]) {
    const cppParams = fnMatch[2].split(',').map(p => p.trim().split(/\s+/).pop()).filter(Boolean);
    cppArgList = cppParams.map((pName, i) => {
      if (injectedNames.includes(pName)) return pName;
      const fuzzy = injectedNames.find(
        n => n.toLowerCase().includes(pName.toLowerCase()) || pName.toLowerCase().includes(n.toLowerCase())
      );
      return fuzzy || injectedNames[i] || 'nullptr';
    }).join(', ');
  }

  // FIX 2 : appel via instance de classe si méthode dans une classe
  const classMatch    = userCode.match(/class\s+(\w+)/);
  const className     = classMatch?.[1] || null;
  const fnName        = fnMatch?.[1] || 'solve';
  const isClassMethod = className !== null;

  const callExpr = isClassMethod
    ? `${className}().${fnName}(${cppArgList})`
    : `${fnName}(${cppArgList})`;

  // FIX 3 : _toJson à la place de if constexpr (C++17) → compatible C++14
  return `
#include <bits/stdc++.h>
using namespace std;

static string _toJson(int v)            { return to_string(v); }
static string _toJson(long v)           { return to_string(v); }
static string _toJson(long long v)      { return to_string(v); }
static string _toJson(double v)         { ostringstream _o; _o << v; return _o.str(); }
static string _toJson(float v)          { ostringstream _o; _o << v; return _o.str(); }
static string _toJson(bool v)           { return v ? "true" : "false"; }
static string _toJson(const string& v)  { return "\\"" + v + "\\""; }
static string _toJson(char v)           { string _s(1, v); return "\\"" + _s + "\\""; }
template<typename T>
static string _toJson(const vector<T>& v) {
    string r = "[";
    for (int i = 0; i < (int)v.size(); i++) { if (i) r += ","; r += _toJson(v[i]); }
    return r + "]";
}

${userCode}

int main() {
${cppDecls}
    auto _result = ${callExpr};
    cout << _toJson(_result) << endl;
    return 0;
}
`;
}

function _buildSource(lang, userCode, inputObj) {
  if (typeof inputObj !== 'object' || Array.isArray(inputObj) || inputObj === null) {
    throw new Error(`Input must be a plain object, got: ${JSON.stringify(inputObj)}`);
  }
  const entries        = Object.entries(inputObj);
  const injectedNames  = entries.map(([k]) => k);
  const injectedValues = entries.map(([, v]) => v);

  switch (lang) {
    case 'javascript': return _buildJavaScript(userCode, entries, injectedNames, injectedValues);
    case 'python':     return _buildPython(userCode, entries, injectedNames, injectedValues);
    case 'java':       return _buildJava(userCode, entries, injectedNames, injectedValues);
    case 'cpp':        return _buildCpp(userCode, entries, injectedNames, injectedValues);
    default:           return userCode;
  }
}

// ── Judge0 execution ──────────────────────────────────────────────────────────

async function _executeCode(lang, source) {
  const langId = LANG_IDS[lang];
  if (!langId) throw new Error(`Unsupported language: ${lang}`);

  const headers = { 'Content-Type': 'application/json' };
  if (JUDGE0_KEY) headers['X-Auth-Token'] = JUDGE0_KEY;

  const submitRes = await axios.post(
    `${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`,
    { source_code: source, language_id: langId, cpu_time_limit: 5, memory_limit: 128_000 },
    { headers }
  );

  const token = submitRes.data.token;
  if (!token) throw new Error('Judge0 returned no token.');

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const poll = await axios.get(`${JUDGE0_URL}/submissions/${token}?base64_encoded=false`, { headers });
    const { status, stdout, stderr, time, memory } = poll.data;
    if (status.id <= 2) continue; // In Queue / Processing
    return {
      statusId:   status.id,
      statusDesc: status.description,
      stdout:     stdout || '',
      stderr:     stderr || '',
      time:       time ? parseFloat(time) * 1000 : null,
      memoryKb:   memory || null,
    };
  }
  throw new Error('Execution timeout exceeded.');
}

function _parseOutput(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) {}
  if (/^-?\d+(\s+-?\d+)+$/.test(s)) return s.split(/\s+/).map(Number);
  if (/^-?\d+(\.\d+)?$/.test(s))   return parseFloat(s);
  return s;
}

function _deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b)   return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => _deepEqual(v, b[i]));
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.join(',') === kb.join(',') && ka.every(k => _deepEqual(a[k], b[k]));
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return false;
}

// ── Complexity heuristic ──────────────────────────────────────────────────────

function _analyzeComplexity(code) {
  const has = pattern => pattern.test(code);
  const hasHashMap      = has(/\b(Map|Set|dict|HashMap|HashSet|unordered_map|unordered_set)\b/);
  const hasNestedLoop   = has(/for[\s\S]{1,300}for|while[\s\S]{1,300}while/);
  const hasTripleLoop   = has(/for[\s\S]{1,200}for[\s\S]{1,200}for/);
  const hasSingleLoop   = has(/\b(for|while|forEach|\.map\(|\.reduce\(|\.filter\()\b/);
  const hasSorting      = has(/\.sort\(|sorted\(|Arrays\.sort|sort\(/);
  const hasBinarySearch = has(/\b(binarySearch|binary_search|lo\s*=|hi\s*=|mid\s*=)\b/);
  const hasRecursion    = has(/function\s+(\w+)[^{]*\{[\s\S]*\1\s*\(/) || has(/def\s+(\w+)[^:]*:[\s\S]*\1\s*\(/);
  const hasDivide       = hasBinarySearch || hasSorting || hasRecursion;

  let time;
  if (hasTripleLoop)                    time = { notation: 'O(n³)',      label: 'Cubic',       efficiency: 10, note: 'Triple nested loop.' };
  else if (hasNestedLoop)               time = { notation: 'O(n²)',      label: 'Quadratic',   efficiency: 30, note: 'Double nested loop.' };
  else if (hasHashMap && hasSingleLoop) time = { notation: 'O(n)',       label: 'Linear',      efficiency: 92, note: 'Hash map + single loop.' };
  else if (hasDivide)                   time = { notation: 'O(n log n)', label: 'Log-linear',  efficiency: 65, note: 'Sort or binary search.' };
  else if (hasSingleLoop)               time = { notation: 'O(n)',       label: 'Linear',      efficiency: 80, note: 'Single loop.' };
  else                                  time = { notation: 'O(?)',       label: 'Unknown',     efficiency: 50, note: 'Not statically determinable.' };

  const space = hasHashMap
    ? { notation: 'O(n)', label: 'Linear',   efficiency: 60, note: 'Hash map/set up to n entries.' }
    : { notation: 'O(1)', label: 'Constant', efficiency: 95, note: 'No additional data structure.' };

  return { time, space, note: '⚠ Static heuristic — not a dynamic profiler.' };
}

// ── POST /api/code-runner/run ─────────────────────────────────────────────────

exports.runCode = async (req, res, next) => {
  try {
    const { language = 'javascript', code, testCases = [] } = req.body;

    if (!code?.trim())      return res.status(400).json({ message: 'code is required.' });
    if (!testCases.length)  return res.status(400).json({ message: 'testCases[] is required.' });

    for (const [i, tc] of testCases.entries()) {
      if (typeof tc.input !== 'object' || Array.isArray(tc.input) || tc.input === null) {
        return res.status(400).json({
          message: `testCases[${i}].input must be a JSON object, got: ${JSON.stringify(tc.input)}`,
        });
      }
    }

    const results = await Promise.all(
      testCases.map(async tc => {
        let source;
        try {
          source = _buildSource(language, code, tc.input);
        } catch (buildErr) {
          return { input: tc.input, expected: tc.expected, got: null, pass: false, error: `Build error: ${buildErr.message}`, status: 'Build Error' };
        }

        try {
          const exec = await _executeCode(language, source);
          const got  = _parseOutput(exec.stdout);
          return {
            input:    tc.input,
            expected: tc.expected,
            got,
            pass:     _deepEqual(got, tc.expected),
            time:     exec.time ? Math.round(exec.time * 100) / 100 : null,
            memoryKb: exec.memoryKb,
            stderr:   exec.stderr || null,
            status:   exec.statusDesc,
          };
        } catch (err) {
          return { input: tc.input, expected: tc.expected, got: null, pass: false, error: err.message, status: 'Error' };
        }
      })
    );

    const passedCount = results.filter(r => r.pass).length;
    const allPassed   = passedCount === results.length;

    res.json({
      results,
      complexity:  _analyzeComplexity(code, language),
      score:       allPassed ? 100 : 0,
      allPassed,
      passedCount,
      totalCount:  results.length,
    });
  } catch (err) {
    console.error('[runCode]', err);
    next(err);
  }
};