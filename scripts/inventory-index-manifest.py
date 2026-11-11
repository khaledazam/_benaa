"""Offline Prisma MongoDB index manifest. Does not import a driver or connect.

Nullable unique fields require review: MongoDB's ordinary unique index permits
only one null/missing value. This generator reports, rather than silently changes,
that schema policy. Applying any indexes is a separate approved operation.
"""
import argparse, hashlib, json, pathlib, re

def derive(schema: str):
    models = []
    for match in re.finditer(r'^model\s+(\w+)\s*\{(.*?)^\}', schema, re.M | re.S):
        name, body = match.groups()
        fields = {}
        collection_map = re.search(r'@@map\("([^"]+)"\)', body)
        collection = collection_map.group(1) if collection_map else name
        indexes = []
        for line in body.splitlines():
            line = line.split('//', 1)[0].strip()
            field = re.match(r'^(\w+)\s+(\w+)(\?|\[\])?\s*(.*)', line)
            if not field: continue
            key, kind, modifier, attrs = field.groups()
            mapped = re.search(r'@map\("([^"]+)"\)', attrs)
            fields[key] = {'mongo': mapped.group(1) if mapped else key, 'nullable': modifier == '?', 'type': kind}
            if re.search(r'@id\b|@unique\b', attrs):
                indexes.append({'fields': [key], 'unique': True, 'source': '@id' if '@id' in attrs else '@unique', 'primary': '@id' in attrs})
        directives = re.findall(r'@@(index|unique)\s*\(\[([^\]]+)\](.*?)\)', body)
        for directive, names, options in directives:
            keys = [part.strip() for part in names.split(',')]
            if any(not re.fullmatch(r'\w+', key) for key in keys): raise ValueError('Unsupported index expression in ' + name)
            if options.strip(): raise ValueError('Index options need explicit parser support in ' + name)
            indexes.append({'fields': keys, 'unique': directive == 'unique', 'source': '@@' + directive, 'primary': False})
        for index in indexes:
            keys = index.pop('fields')
            index['key'] = {fields[key]['mongo']: 1 for key in keys}
            index['nullableFields'] = [fields[key]['mongo'] for key in keys if fields[key]['nullable']]
            index['name'] = '_id_' if index['primary'] else collection + '_' + '_'.join(keys) + ('_key' if index['unique'] else '_idx')
            index['reviewRequired'] = bool(index['unique'] and index['nullableFields'])
            if index['reviewRequired']:
                index['warning'] = 'Nullable unique semantics: review existing null/missing/duplicate values and approve a partial-index policy before applying; do not run blanket db push.'
        models.append({'model': name, 'collection': collection, 'indexes': indexes})
    if len(models) != len(re.findall(r'^model\s+', schema, re.M)): raise ValueError('Incomplete model parsing')
    return models

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    schema = (pathlib.Path(__file__).resolve().parents[1] / 'prisma/schema.prisma').read_bytes()
    models = derive(schema.decode('utf-8-sig'))
    manifest = {'schemaSha256': hashlib.sha256(schema).hexdigest(), 'mode': 'offline only; no database verification performed', 'models': models,
                'modelCount': len(models), 'indexCount': sum(len(m['indexes']) for m in models),
                'nullableUniqueReviewCount': sum(i['reviewRequired'] for m in models for i in m['indexes'])}
    pathlib.Path(args.output).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in manifest.items() if k != 'models'}))
