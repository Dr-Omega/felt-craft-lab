"""Known-design controls, not real-image validation or automatic-mode answers."""
import numpy as np
import cv2

PALETTE=[[8,8,8],[182,44,48],[204,59,61],[25,139,64],[30,80,211],[238,211,123],
         [130,43,185],[36,182,187],[221,123,30]]

def control(colors=6,variant='clean'):
    if colors not in (5,6,9): raise ValueError('declared design count required')
    labels=np.zeros((112,160),np.int32)
    labels[12:100,12:148]=1
    # Different design families, not the same picture counted as more samples.
    for index in range(1,colors):
        row,col=divmod(index-1,4)
        y=22+row*37; x=22+col*29
        labels[y:y+24,x:x+22]=index+1
    labels[18:24,135:140]=colors # disconnected same-colour motif
    labels[6:9,55:58]=4 # intentional small independent decoration
    labels[87,130]=5 # intentional one-pixel interior detail
    labels[40:46,42:47]=0 # real hole cutting two design colours
    labels[60:90,18]=2 # one-pixel line of a known design colour
    if colors==9: labels=np.rot90(labels).copy()
    rgba=np.full((*labels.shape,4),255,np.uint8);rgba[...,3]=np.where(labels>0,255,0)
    for index,rgb in enumerate(PALETTE[:colors],1): rgba[labels==index,:3]=rgb
    if variant not in ('clean','texture','tint','edge'): raise ValueError('unknown perturbation')
    if variant=='texture':
        noise=np.random.default_rng(100+colors).integers(-3,4,(*labels.shape,3))
        rgba[labels>0,:3]=np.clip(rgba[labels>0,:3].astype(int)+noise[labels>0],0,255)
    if variant=='tint':
        rgba[labels>0,:3]=np.clip(rgba[labels>0,:3].astype(int)+[3,-2,1],0,255)
    if variant=='edge':
        support=(labels>0).astype(np.uint8)
        edge=(support>0)&~cv2.erode(support,np.ones((3,3),np.uint8)).astype(bool)
        rgba[edge,:3]=np.rint(rgba[edge,:3]*.8+255*.2).astype(np.uint8)
        rgba[edge,3]=180
    return rgba,labels,[list(c) for c in PALETTE[:colors]]

def validation_design(variant='clean'):
    """Separate nested-ribbon design family, reserved for final evaluation."""
    labels=np.zeros((138,154),np.int32)
    labels[12:126,12:142]=1
    for index in range(1,9):
        y=17+index*11
        labels[y:y+7,20+index*2:130-index*3]=index+1
    labels[18:23,100:107]=8
    labels[4:7,40:43]=4
    labels[55:60,64:69]=0
    labels[29:50,135]=3
    labels[120,20]=6
    rgba=np.full((*labels.shape,4),255,np.uint8);rgba[...,3]=np.where(labels>0,255,0)
    for i,rgb in enumerate(PALETTE,1):rgba[labels==i,:3]=rgb
    if variant=='texture':
        noise=np.random.default_rng(901).integers(-3,4,(*labels.shape,3))
        rgba[labels>0,:3]=np.clip(rgba[labels>0,:3].astype(int)+noise[labels>0],0,255)
    elif variant=='tint':rgba[labels>0,:3]=np.clip(rgba[labels>0,:3].astype(int)+[3,-2,1],0,255)
    elif variant=='edge':
        mask=(labels>0).astype(np.uint8);edge=(mask>0)&~cv2.erode(mask,np.ones((3,3),np.uint8)).astype(bool)
        rgba[edge,:3]=np.rint(rgba[edge,:3]*.8+255*.2).astype(np.uint8);rgba[edge,3]=180
    elif variant!='clean':raise ValueError('unknown perturbation')
    return rgba,labels,[list(c) for c in PALETTE]
