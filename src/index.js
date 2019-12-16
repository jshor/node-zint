var binary = require('node-pre-gyp');
var path = require('path');
var binding_path = binary.find(path.resolve(path.join(__dirname,'../package.json')));
var symbology = require(binding_path);
var fs = require('fs');
var PNGImage = require('pngjs-image');

/* enumerated types in exports */
var exp = {
  Barcode: require('./enums/barcode'),
  DataMatrix: require('./enums/dataMatrix'),
  Encoding: require('./enums/encoding'),
  ErrorCode: require('./enums/errorCode'),
  Options: require('./enums/options'),
  Output: require('./enums/output')
};

/**
 * Symbol struct, populated with default values
 */
var defaultSymbol = {
  symbology: 20,
  height: 50,
  whitespaceWidth: 0,
  borderWidth: 0,
  outputOptions: -1,
  foregroundColor: '000000',
  backgroundColor: 'ffffff',
  fileName: 'out.bmp',
  scale: 1.0,
  option1: -1,
  option2: -1,
  option3: -1,
  showHumanReadableText: true,
  encoding: exp.Encoding.DATA_MODE,
  eci: 0,
  primary: ''
};

/**
 * Merges Symbol struct with user-defined symbologyStruct
 * properties. Ensures properties sent are valid.
 *
 * @param  {Symbol} obj Symbol struct
 * @return {Symbol} obj Symbol struct
 */
function validateSymbol(symbologyStruct) {
  var keys = Object.keys(defaultSymbol);

  for (var i=0; i<keys.length; i++) {
    if (!symbologyStruct.hasOwnProperty(keys[i])) {
      symbologyStruct[keys[i]] = defaultSymbol[keys[i]];
    }
  }
}

/**
 * Calls the given function name from the c++ library wrapper, validates
 * the struct values and passes the arguments sent in symbologyStruct
 * in the correct order.
 *
 * @param  {Symbol} symbologyStruct
 * @param  {String}     barcodeData
 * @param  {String}     fnName          name of fn to call from c++ lib
 * @return {Struct}                     result of called function
 */
function createSymbology(symbologyStruct, barcodeData, fnName) {
  validateSymbol(symbologyStruct);

  return symbology[fnName](
    barcodeData,
    symbologyStruct.symbology,
    symbologyStruct.height,
    symbologyStruct.whitespaceWidth,
    symbologyStruct.borderWidth,
    symbologyStruct.outputOptions,
    symbologyStruct.backgroundColor,
    symbologyStruct.foregroundColor,
    // indicate to the library that we want BMP instead of PNG
    symbologyStruct.fileName.replace(/\.png$/g, '.bmp'),
    symbologyStruct.scale,
    symbologyStruct.option1,
    symbologyStruct.option2,
    symbologyStruct.option3,
    symbologyStruct.showHumanReadableText ? 1 : 0,
    (symbologyStruct.text || barcodeData),
    symbologyStruct.encoding,
    symbologyStruct.eci,
    symbologyStruct.primary
  );
}

/**
 * Renders a PNG Blob stream to a base64 PNG.
 *
 * @param  {PNGJS} image
 * @return {Promise<String>} base64 representation
 */
function blobToBase64Png(image) {
  var png = image.getImage();
  var chunks = [];

  return new Promise(function(resolve) {
    png.pack();
    png.on('data', function(chunk) {
      chunks.push(chunk);
    });
    png.on('end', function() {
      var result = Buffer.concat(chunks);
      resolve('data:image/png;base64,' + result.toString('base64'));
    });
  });
}

/**
 * Renders RGB 24 bitmap into an image instance of PNG
 *
 * @param  {Array}  bitmap  containing RGB values
 * @param  {Number} width   width of bitmap
 * @param  {Number} height  height of bitmap
 * @return {PNG}            instance of PNG (not PNGJS!)
 */
function pngRender(bitmap, width, height) {
  var image = PNGImage.createImage(width, height);
  var i = 0;

  for(var y = 0; y<height; y++) {
    for(var x = 0; x<width; x++) {
      image.setAt(x, y, {
        red: bitmap[i],
        green: bitmap[i+1],
        blue: bitmap[i+2],
        alpha: 200
      });
      i += 3;
    }
  }

  return image;
}

/**
 * Renders a png, svg, or eps barcode.
 * If PNG, it returns the stream as a base64 string.
 *
 * @note The file will be created in memory and then passed to the returned object.
 *
 * @private
 * @param {Symbol} symbol - Symbol struct
 * @param {String} barcodeData - data to encode
 * @param {String} outputType - 'png', 'svg', or 'eps' (default: 'png')
 * @param {Boolean} isStdout - if true, forces the buffer to write to rendered_data
 * @returns {Promise<Object>} object with resulting props (see docs)
 */
function callManagedLibrary(symbol, barcodeData, outputType, isStdout) {
  if (!Object.values(exp.Output).includes(outputType)) {
    throw new Error(`Invalid output type: ${outputType}`)
  }

  if (outputType !== exp.Output.PNG) {
    symbol.fileName = `out.${outputType}`

    if (parseInt(symbol.outputOptions, 10) > 0) {
      symbol.outputOptions += 8
    } else {
      symbol.outputOptions = 8
    }
  }

  var res = createSymbology(symbol, barcodeData, 'createStream');

  if(res.code <= 2) {
    return Promise.resolve({
      data: res.encodedData,
      message: res.message,
      code: res.code,
      width: res.width,
      height: res.height
    });
  }
  return Promise.reject({
    message: res.message,
    code: res.code
  });
};

/**
 * Creates an in-memory of a PNG, SVG or EPS file in the specified fileName path.
 *
 * @param {Symbol} symbol - symbol struct
 * @param {String} barcodeData - data to encode
 * @param {String} outputType - `png`, `eps`, or `svg`.
 * @returns {Promise<Object>} object with resulting props (see docs)
 */
exp.createStream = function(symbol, barcodeData, outputType = exp.Output.PNG) {
  return callManagedLibrary(symbol, barcodeData, outputType, true)
    .then((res) => {
      if (outputType === exp.Output.PNG) {
        var pngData = pngRender(res.data, res.width, res.height);

        return blobToBase64Png(pngData)
          .then(function(base64Data) {
            return {
              data: base64Data,
              width: res.width,
              height: res.height,
              message: res.message,
              code: res.code
            };
          });
      }
      return res
    })
}

/**
 * Creates a file of a PNG, SVG or EPS file in the specified fileName path.
 *
 * @param {Symbol} symbol - symbol struct
 * @param {String} barcodeData - data to encode
 * @param {String} outputType - `png`, `eps`, or `svg`.
 * @returns {Promise<Object>} object with resulting props (see docs)
 */
exp.createFile = function(symbol, barcodeData) {
  let outputType

  try {
    outputType = symbol.fileName.match(/\.([a-z]+)$/i).pop().toLowerCase()
  } catch (e) {
    throw new Error('Invalid file extension. fileName must end with \'.png\', \'.eps\', or \'.svg\'.')
  }

  return callManagedLibrary(symbol, barcodeData, outputType)
    .then((res) => {
      if (outputType === exp.Output.PNG) {
        var image = pngRender(res.data, res.width, res.height);

        return new Promise((resolve, reject) => {
          image.writeImage(symbol.fileName, function(err) {
            if (err) {
              reject(err)
            } else {
              delete res.data

              resolve(res)
            }
          });
        });
      }

      fs.writeFileSync(symbol.fileName, res.data)

      delete res.data

      return res
    })
};

module.exports = exp;
