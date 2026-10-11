// Import a user-supplied Kenney Mini Characters archive. No remote asset downloads.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const archive=process.argv[2];if(!archive)throw new Error('Usage: node scripts/import-characters.mjs <kenney-mini-characters.zip>');
const directory='public/models/kenney';await mkdir(directory+'/Textures',{recursive:true});await mkdir(directory+'/previews',{recursive:true});
for(const group of ['male','female'])for(const suffix of ['a','b','c','d','e','f']){
  const name=`character-${group}-${suffix}`;
  await writeFile(`${directory}/${name}.glb`,execFileSync('unzip',['-p',archive,`Models/GLB format/${name}.glb`]));
  await writeFile(`${directory}/previews/${name}.png`,execFileSync('unzip',['-p',archive,`Previews/${name}.png`]));
}
await writeFile(directory+'/Textures/colormap.png',execFileSync('unzip',['-p',archive,'Models/GLB format/Textures/colormap.png']));
await writeFile(directory+'/License.txt',execFileSync('unzip',['-p',archive,'License.txt']));
console.log('Imported 12 animated Kenney GLBs, shared texture, thumbnails and original license.');
