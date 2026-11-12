const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function productPublicId(productId) {
  return `magaza-pos/products/product-${productId}`;
}

function uploadProductImage(buffer, productId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: productPublicId(productId),
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

function deleteProductImage(productId) {
  return cloudinary.uploader.destroy(productPublicId(productId));
}

module.exports = { cloudinary, uploadProductImage, deleteProductImage };
