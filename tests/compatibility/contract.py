"""Exhaustive SpacetimeDB client contract check for one protocol family.

Usage: python3 contract.py BASELINE_SCHEMA.json CANDIDATE_SCHEMA.json
Each schema is the module's raw definition from GET /v1/database/<db>/schema?version=9.

Released clients of the family call every reducer/procedure and decode every public
view/table of the baseline. The candidate may add those, but must not remove or change
any of them: old clients would fail on call or on row decode. SpacetimeDB's own
"will BREAK existing clients" publish check covers columns only, never reducer
arguments, and production publishes with --yes. Breaking changes need a new protocol.
"""
import copy
import json
import sys


def contract(schema: dict) -> dict[str, object]:
    types = schema['typespace']['types']

    def resolve(node, seen=()):
        # Inline typespace refs so independent builds compare structurally.
        if isinstance(node, dict) and set(node) == {'Ref'}:
            ref = node['Ref']
            return {'Recursive': ref} if ref in seen else resolve(types[ref], seen + (ref,))
        if isinstance(node, dict):
            return {key: resolve(value, seen) for key, value in node.items()}
        if isinstance(node, list):
            return [resolve(value, seen) for value in node]
        return node

    surface: dict[str, object] = {}
    for reducer in schema['reducers']:
        if reducer['lifecycle'] == {'none': []}:  # init/connect hooks are not client callable
            surface['reducer ' + reducer['name']] = resolve(reducer['params'])
    for table in schema['tables']:
        if 'Public' in table['table_access']:
            surface['table ' + table['name']] = resolve({'Ref': table['product_type_ref']})
    for export in schema['misc_exports']:
        if 'Procedure' in export:
            item = export['Procedure']
            surface['procedure ' + item['name']] = resolve([item['params'], item['return_type']])
        elif 'View' in export and export['View']['is_public']:
            item = export['View']
            surface['view ' + item['name']] = resolve([item['params'], item['return_type']])
    return surface


def breaking(baseline: dict, candidate: dict) -> list[str]:
    old, new = contract(baseline), contract(candidate)
    return [f'{name}: removed' if name not in new else f'{name}: signature changed'
            for name, signature in sorted(old.items()) if new.get(name) != signature]


if __name__ == '__main__':
    baseline, candidate = (json.loads(open(path).read()) for path in sys.argv[1:3])
    # Guard against a silently blind check: a mutated baseline must be detected.
    probe = copy.deepcopy(baseline)
    callable_reducer = next(r for r in probe['reducers'] if r['lifecycle'] == {'none': []})
    callable_reducer['params']['elements'].append({'name': {'some': 'probe'}, 'algebraic_type': {'Bool': []}})
    assert breaking(baseline, probe) == [f'reducer {callable_reducer["name"]}: signature changed'], 'contract check is blind'
    assert len(contract(baseline)) > 0

    problems = breaking(baseline, candidate)
    if problems:
        print('Breaking changes to the client contract of this protocol family:', *problems, sep='\n  ')
        print('Restore them, or start a new protocol family (VersionInfo.ClientProtocol).')
        raise SystemExit(1)
    print(f'PASS contract: all {len(contract(baseline))} baseline reducers, procedures, views and public tables unchanged')
