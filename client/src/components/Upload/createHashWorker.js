// 导入脚本
import SparkMD5 from "spark-md5";

// 生成文件 hash
self.onmessage = (e) => {
  const chunkFileList = e.data;
  const spark = new SparkMD5.ArrayBuffer();
  let currentChunk = 0;
  const loadNext = (index) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(chunkFileList[index]);
    reader.onload = (e) => {
      currentChunk++;
      spark.append(e.target.result);
      if (currentChunk === chunkFileList.length) {
        self.postMessage({
          hash: spark.end(),
        });
        self.close();
      } else {
        loadNext(currentChunk);
      }
    };
  };
  loadNext(0);
};
