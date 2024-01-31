import express from "express";
import path from "path";
import { mkdirp, remove } from "fs-extra/esm";
import { readdir, readFile } from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import multer from "multer";

const app = express();

/********************* 文件存放目录 **********************/
// 大文件临时存储目录
const UPLOAD_TEMP_DIR = path.resolve("public/temp");
// 大文件存储目录
const UPLOAD_DIR = path.resolve("public/assets");

/************************ 中间件 *************************/

// 使用cors解决跨域
app.use((req, res, next) => {
  res.set("access-control-allow-origin", "*");
  res.set("access-control-allow-Headers", "*");
  if (req.method.toUpperCase() === "OPTIONS") {
    res.status(200).end();
    return;
  }
  next();
});
// 解析请求体数据
app.use(express.json());
// 设置静态资源中间件
app.use(express.static("public"));

// 文件上传中间件
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const hash = file.originalname.split("-")[1];
    const dir = UPLOAD_TEMP_DIR + `/temp_${hash}`;
    await mkdirp(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const filename = file.originalname.split("-").slice(1).join("-");
    cb(null, filename);
  },
});
const upload = multer({ storage: storage });

/************************** 路由 ***************************/
// 1. 接受文件上传
app.post("/upload/file", upload.array("chunk"), (req, res) => {
  res.json({
    code: 200,
    success: true,
    message: null,
    data: req.files.map((file) => file.filename),
  });
});

// 获取文件扩展名
function getExtName(filename) {
  const names = filename.split(".");
  return names[names.length - 1];
}
// 获取hash
function getHash(filepath) {
  const paths = filepath.split("_");
  return paths[paths.length - 1];
}

// 合并文件
async function mergeChunkFile(filepath, filename, size = 10 * 1024 * 1024) {
  // 读取文件夹下所有文件
  const chunkFilesPath = await readdir(filepath);
  // 进行排序，防止合并顺序错乱
  chunkFilesPath.sort((a, b) => a.split("-")[1] - b.split("-")[1]);

  const ext = getExtName(filename);
  const hash = getHash(filepath);

  // 写入文件
  const rsPromisify = chunkFilesPath.map((path, index) => {
    return new Promise((resolve) => {
      // 创建可读流
      const rs = createReadStream(`${filepath}/${path}`);
      // 创建可写流
      const ws = createWriteStream(`${UPLOAD_DIR}/${hash}.${ext}`, {
        start: index * size,
      });
      rs.once("end", () => {
        // 可读流读完了
        resolve();
      });
      rs.pipe(ws);
    });
  });

  // 等所有可读流完事，说明所有文件写入完毕了
  await Promise.all(rsPromisify);

  // 删除临时文件
  // await remove(filepath);
}

// 2. 通知合并文件
app.post("/merge/file", async (req, res) => {
  const { filename, fileHash } = req.body;
  const filepath = UPLOAD_TEMP_DIR + `/temp_${fileHash}`;
  await mergeChunkFile(filepath, filename);
  const ext = getExtName(filename);
  res.json({
    code: 200,
    success: true,
    message: null,
    data: `http://localhost:3000/assets/${fileHash}.${ext}`,
  });
});

// 3. 确认文件是否上传过，返回已上传的部分切片名称
app.post("/verify/file", async (req, res) => {
  const { filename, fileHash } = req.body;
  const ext = getExtName(filename);
  const hashName = `${fileHash}.${ext}`;
  try {
    // 1. 判断该文件是否上传过
    await readFile(path.resolve(UPLOAD_DIR, hashName));
    // 上传过了
    res.json({
      code: 200,
      success: true,
      message: null,
      data: {
        needUpload: false,
        url: `http://localhost:3000/assets/${hashName}`,
      },
    });
  } catch {
    // 没有上传过
    // 2. 判断是否上传过部分
    try {
      const dir = UPLOAD_TEMP_DIR + `/temp_${fileHash}`;
      const chunkFileList = await readdir(dir);
      // 上传过部分，返回
      res.json({
        code: 200,
        success: true,
        message: null,
        data: {
          needUpload: true,
          chunkFileList,
        },
      });
    } catch (e) {
      res.json({
        code: 200,
        success: true,
        message: null,
        data: {
          needUpload: true,
        },
      });
    }
  }
});

app.listen(3000, "localhost", (err) => {
  if (err) console.log("服务器启动失败", err);
  else console.log("服务器启动成功了");
});
