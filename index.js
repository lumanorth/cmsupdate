#!/usr/bin/env node

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

async function recursiveDownloadImages(obj, config, level = 0) {
    if (obj.type === 'image') {
    }
    else if (typeof(obj) === 'object') {
        if (level == 0 && config.generate) {
            if (config.generate.id) {
                const idPart = typeof(config.generate.id) === 'string' ? [config.generate.id] : config.generate.id

                let key = ''
                for (let s of idPart) {
                    key += obj[s].replaceAll(' ', '-').replaceAll('/', '-').replaceAll('#', '') + '-'
                }
    
                obj.id = encodeURIComponent(key.toLowerCase()) + obj['_id']
            }
            
            if (config.generate.timeStamps) {
                obj.createdAt = (new Date(obj['_created'] * 1000)).toISOString()
                obj.modifiedAt = (new Date(obj['_modified'] * 1000)).toISOString()
            }
        }

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
                        
                        let maxWidth = config.imageWidth ? config.imageWidth : 256
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
                    obj[key] = val.name || val.slug
                }
                else {
                    await recursiveDownloadImages(obj[key], config, level + 1)
                }
            }
        }
    }
}

async function cache(model) {

    if (model == null) {
        let items = (await axios.get(`/pages/pages`, { params: { fields: JSON.stringify({ id: true }) } })).data
        if (items.length == 0) { return }

        if (!fs.existsSync('src/content/pages')) {
            fs.mkdirSync('src/content/pages', { recursive: true })
        }
        
        const existingFiles = fs.readdirSync('src/content/pages')

        for (let item of items) {
            let data = (await axios.get(`/pages/page/${item._id}`, { params: { populate: 100 } })).data
            data.route = data._routes.default
            const path = data._routes.default.substring(1).replaceAll('/', '---')
            await recursiveDownloadImages(data, { name: 'page', config: { } })
            fs.writeFileSync(`src/content/pages/${path}.json`, JSON.stringify(data, null, 2))
            
            let idx = existingFiles.indexOf(`${path}.json`)
            if (idx != -1) {
                existingFiles.splice(idx, 1)
            }
        }

        for (let item of existingFiles) {
            fs.rmSync(`src/content/pages/${item}`)
        }
    }
    else if (model.type === 'document') {
        if (!fs.existsSync(`src/content/${model.name}`)) {
            fs.mkdirSync(`src/content/${model.name}`, { recursive: true })
        }
        let items = (await axios.get(`/content/items/${model.name}`, { params: { fields: JSON.stringify({ id: true }) } })).data
        for (let item of items) {
            let data = (await axios.get(`/content/item/${model.name}/${item._id}`, { params: { populate: 100 } })).data
            await recursiveDownloadImages(data, { name: model.name,  ...model.config })
            fs.writeFileSync(`src/content/${model.name}/${data.slug}.json`, JSON.stringify(data, null, 2))
        }
    }
    else {
        const item = model.type === 'singleton' ? 'item' : 'items'
        let data = (await axios.get(`/content/${item}/${model.name}`, { params: { populate: 1 } })).data
    
        if (model.type === 'singleton') {
            // console.log(JSON.stringify(data, null, 4))
            await recursiveDownloadImages(data, { name: model.name,  ...model.config })    
        }
        else {
            for (let item of data) {
                await recursiveDownloadImages(item, { name: model.name,  ...model.config })
            }
        }
    
        fs.writeFileSync(`src/data/${model.name}.json`, JSON.stringify(data, null, 2))
    }
} 

await cache(null)

for (let model of cms.models) {
    await cache(model)
}

console.log('🚀 cmsupdate complete 🏁')
