const { getBlobs } = require('@/modules/blobstorage/services')
const { keyBy } = require('lodash')

module.exports = {
  SmartTextEditorValue: {
    attachments(parent) {
      const { blobIds } = parent
      if (!blobIds) return null

      const blobs = getBlobs({ blobIds })
      const blobsById = keyBy(blobs, (b) => b.id)
      return blobIds.map((blobId) => blobsById[blobId] || null)
    }
  }
}
