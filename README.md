# ChinaEx

An interactive travel-tracker map of mainland China at the prefecture level. Click any prefecture to record your travel level (Lived, Stayed, Visited, Alighted, Passed, Never), see your score update live, and share your map via a URL.

## Features

- 450 clickable prefecture-level regions across mainland China
- Six travel levels per region, with a running score
- Province halo tinting: provinces with any visited prefecture get a light tint on their remaining regions
- Main long-distance train lines drawn over the map (high-speed routes plus the Xining-Lhasa conventional line) so you can record prefectures you passed through by train
- Language toggle: English and Simplified Chinese (with Pinyin)
- Annotations: add arrows and captions, drag, rotate, and edit them
- Shareable URL that encodes your full map state
- Save the map as a PNG image
- Draggable legend

## Running locally

The app is fully static. Serve it over HTTP (opening `index.html` directly via `file://` will block the local script loads):

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Credits

Built by [Alan Saas](https://saasontech.com/). Originally inspired by [JapanEx](https://zhung.com.tw/japanex/).

Region geometry derived from DataV GeoAtlas. Train line geometry derived from OpenStreetMap.
