"""Display actual shared geometry once per edge; never alter Piece geometry."""
import html


def _write_shared_edge_svg(path, vector, shape):
    height,width = shape[:2]
    paths = []
    for edge in vector['geometry']:
        commands=[]
        for segment in edge['segments']:
            xy=lambda p: ','.join(format(float(v),'.17g') for v in p)
            commands.append('M '+xy(segment['p0']))
            if segment['type'] == 'CUBIC':
                commands.append('C '+' '.join(xy(segment[k]) for k in ('c1','c2','p1')))
            else:
                commands.append('L '+xy(segment['p1']))
        paths.append('<path data-edge-id="'+html.escape(edge['edgeId'],quote=True)+'" d="'+' '.join(commands)+'"/>')
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+str(width)+' '+str(height)+'">'
        '<rect width="100%" height="100%" fill="white"/><g fill="none" stroke="#172b45" stroke-width="0.35">'
        +''.join(paths)+'</g></svg>\n',encoding='utf-8',newline='\n')
