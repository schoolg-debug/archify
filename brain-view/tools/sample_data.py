#!/usr/bin/env python3
"""Fictional dataset with the same shape as the one in the reference footage (691 notes, 9 areas).
Used only to compare renders against the video. usage: sample_data.py <out.json>"""
import json, random, sys, datetime
random.seed(7)
AREAS = [
 ("School", "#4F9FF1", [("School",74),("Course 1",21),("Course 2",20),("Course 3",19),("Course 4",19),("Course 5",14),("Course 6",13),("Course 7",13),("Course 8",10),("Course 9",9),("Course 10",8),("Course 11",7),("Course 12",7),("Course 13",7),("Course 14",6),("Course 15",6),("Course 16",5),("Course 17",4),("Course 18",4),("Course 19",4),("Course 20",3)]),
 ("Money & Career", "#3FE29B", [("Career",18),("Budget",14),("Investing",10)]),
 ("Social & Self", "#FB6BA7", [("Journal",20),("People",15)]),
 ("Faith & Worldview", "#F6D752", [("Faith",12),("Worldview",7)]),
 ("AI & Creating", "#A485FB", [("AI",20),("Creating",16)]),
 ("Life & Fun", "#F99445", [("Life",30),("Fun",20),("Travel",14)]),
 ("Gaming & Tech", "#3CDBD1", [("Gaming",55),("Tech",46)]),
 ("Body & Health", "#FD4340", [("Fitness & Nutrition",58),("Health & Skin",56)]),
 ("Core", "#E2E5EE", [("Core",7)]),
]
t0, t1 = datetime.date(2024,8,12), datetime.date(2026,11,18)
span = (t1-t0).days
areas, folders, notes = [], [], []
for ai,(name,color,fl) in enumerate(AREAS):
    areas.append({"name":name,"color":color})
    for fname,cnt in fl:
        fi=len(folders); folders.append({"name":fname,"area":ai})
        for k in range(cnt):
            if name=="Body & Health":   # written in a few recent bursts, like the footage
                day = random.choice([span-20, span-45, span-160]) + random.randint(-6,6) if random.random()<0.8 else random.randint(span//2, span)
            elif name=="School": day = random.randint(0, span)
            else: day = int(span*random.random()**0.7)
            d = t0+datetime.timedelta(days=max(0,min(span,day)))
            notes.append({"t":f"{fname} note {k+1}","f":fi,"d":d.isoformat(),"s":f"A note in {fname}.","src":"vault","l":[]})
N=len(notes); byf={}
for i,n in enumerate(notes): byf.setdefault(n["f"],[]).append(i)
links=set()
while len(links)<2086:
    i=random.randrange(N)
    j=random.choice(byf[notes[i]["f"]]) if random.random()<0.7 else random.randrange(N)
    if i!=j: links.add((min(i,j),max(i,j)))
for i,j in links: notes[i]["l"].append(j); notes[j]["l"].append(i)
json.dump({"title":"Brain View","areas":areas,"folders":folders,"notes":notes,"sources":{"vault":"Vault"}}, open(sys.argv[1],"w"))
print(N,"notes",len(links),"links")
