import axios from 'axios'
import fs from 'fs'
import path from 'path'

let cms = JSON.parse(fs.readFileSync('cms.json'))
const re = /src\s*=\s*"(.+?)"/ig

let cmsCache = []
if (fs.existsSync('cmscache.json')) {
    cmsCache = JSON.parse(fs.readFileSync('cmscache.json'))
}

axios.defaults.baseURL = cms.host + `/:${cms.tenant}/api`
axios.defaults.headers.common['api-key'] = cms.key

async function recursiveDownloadImages(obj, config) {
    if (obj.type === 'image') {
    }
    else if (typeof(obj) === 'object') {
        for (let key of Object.keys(obj)) {

            if (key[0] === '_') {
                delete obj[key]
                continue
            }

            let val = obj[key]
            if (typeof(val) === 'string') {
                let replaces = []

                for (let match of val.matchAll(re)) {
                    const fullpath = match[1]
                    let tpath = '/img/' + config.name + fullpath.split('/uploads/')[1]
                    let lpath = 'public' + tpath
                    replaces.push([ fullpath, tpath ])
                    if (!cmsCache.find(a => a.path == lpath)) {
                        fs.mkdirSync(path.dirname(lpath), { recursive: true })
                        
                        let k = await axios.get(cms.host + fullpath, { responseType: 'arraybuffer' })
                        fs.writeFileSync(lpath, k.data)

                        cmsCache.push({ path: lpath, hash: '-1' })
                        fs.writeFileSync('cmscache.json', JSON.stringify(cmsCache, null, 4))
                    }
                }

                for (let r of replaces) {
                    obj[key] = obj[key].replaceAll(r[0], r[1])
                }
            }
            else if (typeof(val) === 'object' && val != null) {
                let lpath = 'public/img/' + config.name + val.path
                if (val.type === 'image') {
                    if (cmsCache.find(a => a.path === lpath && a.hash === val._hash)) {
                        // nothing to do here, file is good
                    }
                    else if (cmsCache.find(a => a.path === lpath && a.hash !== val._hash)) {
                        // problem file contents doesn't match
                        console.error('same file path, hash changed!')
                    }
                    else {
                        fs.mkdirSync(path.dirname(lpath), { recursive: true })
                        
                        let maxWidth = config.imageWidth ? config.imageWidth : 10000
                        let k = await axios.get(`/assets/image/${val._id}`, { params: { w: maxWidth } })
                        k = await axios.get(k.data, { responseType: 'arraybuffer' })
                        fs.writeFileSync(lpath, k.data)
                        
                        cmsCache.push({ path: lpath, hash: val._hash })
                        fs.writeFileSync('cmscache.json', JSON.stringify(cmsCache, null, 4))
                    }

                    for (let kk of [ 'tags', 'size', 'size', 'type', 'mime', 'width', 'height', '_hash', '_created', '_modified', '_cby', 'folder', '_id' ]) {
                        if (kk in val) { delete val[kk] }
                    }

                    val.path = '/img/' + config.name +  val.path
                    val.description = val.description || val.title
                    delete val.title
                }
                else if ('_model' in val && '_id' in val) {
                    obj[key] = val.name
                }
                else {
                    await recursiveDownloadImages(obj[key], config)
                }
            }
        }
    }
}

async function cache(model) {
    const item = model.type === 'singleton' ? 'item' : 'items'
    let data = (await axios.get(`/content/${item}/${model.name}`, { params: { populate: 1 } })).data

    if (model.type === 'singleton') {
        await recursiveDownloadImages(data, { name: model.name,  ...model.config })    
    }
    else {
        for (let item of data) {
            await recursiveDownloadImages(item, { name: model.name,  ...model.config })
        }
    }

    fs.writeFileSync(`src/${model.name}.json`, JSON.stringify(data, null, 2))
} 

for (let model of cms.models) {
    await cache(model)
}
