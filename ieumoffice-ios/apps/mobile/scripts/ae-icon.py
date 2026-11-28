# AllEditor icon: an Æ monogram in layered glass (iOS 26 "Liquid Glass" look) on a warm gradient tile.
def svg(variant='light', rounded=False):
    W=1024; sw=100
    A='M 280 752 L 500 270'                # A: diagonal leg up to the top of the shared stem
    X='M 383 528 L 500 528'                # A's crossbar, in line with the E's middle arm
    E='M 500 270 L 500 752 M 500 270 L 760 270 M 500 528 L 712 528 M 500 752 L 760 752'
    ALL=A+' '+X+' '+E
    P={
     'light': dict(bg=('#FFB54C','#FF7B33','#E5402B'), glow=('#FFF4D8','.80'), A='#FFFFFF', E='#FFE6D6', Eop='.50', rim='#FFFFFF', rimop='.95', sh='#8E2410', shop='.42', sheet='.10'),
     'dark':  dict(bg=('#34343B','#1C1C21','#0B0B0E'), glow=('#FF8A3D','.30'), A='#FF9442', E='#FFB27A', Eop='.38', rim='#FFD2AE', rimop='.85', sh='#000000', shop='.6', sheet='.05'),
     'tinted':dict(bg=('#2A2A2C','#151516','#000000'), glow=('#FFFFFF','.10'), A='#FFFFFF', E='#FFFFFF', Eop='.32', rim='#FFFFFF', rimop='.9', sh='#000000', shop='.6', sheet='.04'),
    }[variant]
    st=lambda d,col,op,w=sw,extra='': f'<path d="{d}" fill="none" stroke="{col}" stroke-opacity="{op}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'
    defs=('<defs>'
      f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{P["bg"][0]}"/><stop offset=".5" stop-color="{P["bg"][1]}"/><stop offset="1" stop-color="{P["bg"][2]}"/></linearGradient>'
      f'<radialGradient id="glow" cx=".26" cy=".16" r=".75"><stop offset="0" stop-color="{P["glow"][0]}" stop-opacity="{P["glow"][1]}"/><stop offset=".6" stop-color="{P["glow"][0]}" stop-opacity="0"/></radialGradient>'
      f'<filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="28"/><feOffset dy="34"/><feComponentTransfer><feFuncA type="linear" slope="{P["shop"]}"/></feComponentTransfer></filter>'
      f'<clipPath id="tile"><rect width="{W}" height="{W}" rx="{230 if rounded else 0}"/></clipPath>'
      # light falls from above: the upper part of every stroke is brighter (kept inside the strokes by a mask)
      '<linearGradient id="spec" gradientUnits="userSpaceOnUse" x1="0" y1="200" x2="0" y2="820"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>'
      f'<mask id="glyph" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{W}">'+st(ALL,'#fff','1')+'</mask>'
      f'<mask id="glyphA" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{W}">'+st(A+' '+X,'#fff','1')+'</mask>'
      '</defs>')
    body=(f'<g clip-path="url(#tile)"><rect width="{W}" height="{W}" fill="url(#bg)"/><rect width="{W}" height="{W}" fill="url(#glow)"/>'
          f'<rect x="168" y="168" width="688" height="688" rx="168" fill="#FFFFFF" fill-opacity="{P["sheet"]}" stroke="#FFFFFF" stroke-opacity="{float(P["sheet"])*2.4:.2f}" stroke-width="3"/></g>')
    g=f'<g filter="url(#sh)">'+st(ALL,P['sh'],'1')+'</g>'
    # E: frosted glass behind, with a bright rim (edge catching light) around a translucent body
    g+=st(E,P['rim'],P['rimop'],sw)
    g+=st(E,P['E'],'1',sw-10)
    g+=st(E,P['bg'][1],str(1-float(P['Eop'])),sw-10)  # the tile shows through the glass body
    # A: clear glass in front
    g+=st(A+' '+X,P['A'],'1')
    # light from above on the glass, only inside the strokes
    g+=f'<rect width="{W}" height="{W}" fill="url(#spec)" mask="url(#glyph)"/>'
    g+=f'<g mask="url(#glyphA)"><path d="M 280 752 L 500 270" stroke="#fff" stroke-opacity=".35" stroke-width="20" stroke-linecap="round" transform="translate(-26,-8)"/></g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{W}" viewBox="0 0 {W} {W}">{defs}{body}{g}</svg>'
for v in ['light','dark','tinted']:
    open(f'ae-{v}.svg','w').write(svg(v))
open('ae-logo.svg','w').write(svg('light',True))
