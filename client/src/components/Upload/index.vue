<template>
  <el-upload
    v-model:file-list="fileList"
    :limit="FILE_MAX_LENGTH"
    :on-exceed="handleExceed"
    :before-upload="beforeUpload"
    :http-request="handleUpload"
  >
    <el-button type="primary">点击上传</el-button>
    <template #tip>
      <div class="el-upload__tip">上传文件大小不能超过1GB</div>
    </template>
  </el-upload>
</template>

<script lang="ts">
export default {
  name: "Upload",
};
</script>

<script lang="ts" setup>
import { ref } from "vue";
import { ElMessage } from "element-plus";
import type {
  UploadProps,
  // UploadUserFile,
  UploadRequestOptions,
} from "element-plus";
import type {
  ChunkFileList,
  UploadCustomFile,
  OnProgress,
  RequestHandler,
} from "./type";

// 上传的文件列表
const fileList = ref<UploadCustomFile[]>([]);
// 允许上传的文件最大数量
const FILE_MAX_LENGTH = 5;

// 上传超出限制
const handleExceed: UploadProps["onExceed"] = () => {
  ElMessage.warning(`上传图片数量不能超过${FILE_MAX_LENGTH}个！`);
};

// 上传之前
const beforeUpload: UploadProps["beforeUpload"] = (rawFile) => {
  if (rawFile.size / 1024 / 1024 / 1024 > 1) {
    ElMessage.error("上传大小不能超过1G!");
    return false;
  }
  return true;
};

// 使用 web-worker 创建 hash
const createHash = (chunkFileList: Blob[]): Promise<string> => {
  return new Promise((resolve) => {
    // 创建worker
    const worker = new Worker(
      new URL("./createHashWorker.js", import.meta.url),
      {
        type: "module",
      }
    );
    // 给worker发送消息
    worker.postMessage(chunkFileList);
    // 接受worker的消息
    worker.onmessage = (e) => {
      const { hash } = e.data;
      if (hash) {
        resolve(hash);
      }
    };
  });
};

// 切片上传
const handleUpload = async (options: UploadRequestOptions) => {
  // 1. 生成文件切片
  const chunkFileList = createChunkFileList(options.file);
  const name = options.file.name;

  // 生成文件的hash
  const hash = await createHash(chunkFileList);

  // 2. 将切片的数据进行维护成一个包括该切片文件，切片名的对象
  const transformFileList = transformChunkFileList(chunkFileList, name, hash);

  // 上传之前，初始化上传进度
  fileList.value.forEach((file) => {
    if (file.name === name) {
      file.loaded = 0;
      file.status = "uploading";
    }
  });

  // 确认上传切片情况
  const { data } = await verifyRequest(name, hash);

  if (!data.needUpload) {
    console.log(data.url);
    return;
  }

  // 3. 上传切片
  await uploadChunks(transformFileList, name, data.chunkFileList);
  // 4. 合并
  const res = await mergeRequest(name, hash);

  console.log(res);
};

// 自定义切片大小 10mb
const CHUNK_SIZE = 10 * 1024 * 1024;// 单位b

// 1. 生成文件切片
const createChunkFileList = (file: File, size = CHUNK_SIZE) => {
  const chunkFileList = [];
  let currentSize = 0;
  while (currentSize < file.size) {
    // 第一次 0 - 10mb
    // 第二次 10mb - 20mb
    // ...
    chunkFileList.push(file.slice(currentSize, currentSize + size));
    currentSize += size;
  }
  return chunkFileList;
};

// 2. 将切片的数据进行维护成一个包括该切片文件，切片名的对象
const transformChunkFileList = (
  chunkFileList: Blob[],
  name: string,
  hash: string
) => {
  return chunkFileList.map((chunkFile, index) => {
    return {
      chunk: chunkFile, // 切片文件
      hash: `${name}-${hash}-${index}`, // 切片名
    };
  });
};

// 3. 自定义上传切片的方法
const request: RequestHandler = ({
  url,
  data,
  method = "post",
  headers = {},
  onProgress,
}) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (onProgress) {
      xhr.upload.onprogress = onProgress;
    }
    Object.keys(headers).forEach((key) =>
      xhr.setRequestHeader(key, headers[key])
    );
    xhr.addEventListener("load", (e) => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject("失败");
      }
      resolve(JSON.parse((e.target as XMLHttpRequest).responseText));
    });
    xhr.send(data);
  });
};

const handleProgress = (name: string): OnProgress => {
  return (e) => {
    fileList.value.forEach((file) => {
      if (file.name === name) {
        if (e.loaded === e.total) {
          // 已经加载的大小
          file.loaded += e.loaded;
          // 计算百分比
          file.percentage = Number(
            ((file.loaded / (file.size as number)) * 100).toFixed(2)
          );
          if (file.percentage === 100) {
            file.status = "success";
          }
        }
      }
    });
  };
};

// 确认上传切片情况
const verifyRequest = (filename: string, hash: string) => {
  return request({
    url: "http://localhost:3000/verify/file",
    headers: { "content-type": "application/json" },
    data: JSON.stringify({
      filename,
      fileHash: hash,
    }),
  });
};

// 4. 上传切片
const uploadChunks = async (
  fileList: ChunkFileList,
  name: string,
  chunkFileList: string[] = [] // 已经上传好的切片
) => {
  const requestList = fileList
    .filter((file) => {
      return !chunkFileList.some((chunkFile) => file.hash.includes(chunkFile));
    })
    .map(({ chunk, hash }) => {
      const formData = new FormData();
      formData.append("chunk", chunk, hash);
      formData.append("filename", name);
      return formData;
    })
    .map((formData) => {
      return request({
        url: "http://localhost:3000/upload/file",
        data: formData,
        onProgress: handleProgress(name),
      });
    });

  // 并发请求
  await Promise.all(requestList);
};

// 5. 通知服务器合并上传切片成一个文件
const mergeRequest = (name: string, hash: string) => {
  return request({
    url: "http://localhost:3000/merge/file",
    headers: { "content-type": "application/json" },
    data: JSON.stringify({
      filename: name,
      fileHash: hash,
    }),
  });
};
</script>

<style scoped></style>
