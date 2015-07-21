var utils = require("./utils");
var fs = require("fs");
var url = require("url");
var NodeFormData = require("form-data");

module.exports = function(config) {
  return function(req, res) {
    if(!req.body || !req.body.dateUpdated || !req.body.bramblePath) {
      res.status(400).send({error: "Request body missing data"});
      return;
    }

    if(!req.file) {
      res.status(400).send({error: "Request missing file data"});
      return;
    }

    var token = req.user.token;
    var project = req.session.project.meta;
    var dateUpdated = req.body.dateUpdated;
    var file = req.file;
    var filePath = utils.stripProjectRoot(req.session.project.root, req.body.bramblePath);
    var existingFile = req.session.project.files[filePath];
    var httpMethod = "post";
    var resource = "/files";

    if(existingFile) {
      httpMethod = "put";
      resource += "/" + existingFile.id;
    }

    function getUploadBuffer(callback) {
      var tmpFile = file.path;
      fs.readFile(tmpFile, function(err, data) {
        if(err) {
          return callback(err);
        }

        callback(null, data);

        // Dump the temp file upload, but don't wait around for it to finish
        fs.unlink(tmpFile, function(err) {
          console.log("unable to remove upload tmp file, `" + tmpFile + "`", err);
        });
      });
    }

    function storeFile(buffer) {
      var options = url.parse(config.publishURL + resource);
      options.method = httpMethod;
      options.headers = {
        "Authorization": "token " + token
      };

      var formData = new NodeFormData();
      formData.append("path", filePath);
      formData.append("project_id", project.id);
      formData.append("buffer", buffer);

      formData.submit(options, function(err, response) {
        if(err) {
          console.error("Failed to send request to " + config.publishURL + resource + " with: ", err);
          res.sendStatus(500);
          return;
        }

        if(response.statusCode !== 201 && response.statusCode !== 200) {
          res.status(response.statusCode).send({error: response.body});
          return;
        }

        project.date_updated = dateUpdated;

        utils.updateProject(config, token, project, function(err, status, project) {
          if(err) {
            res.status(status).send({error: err});
            return;
          }

          if(status === 500) {
            res.sendStatus(500);
            return;
          }

          req.session.project.meta = project;

          if(httpMethod === "post") {
            req.session.project.files[filePath] = {
              id: response.body.id,
              path: filePath,
              project_id: project.id
            };
            res.sendStatus(201);
            return;
          }

          res.sendStatus(200);
        });
      });
    }

    getUploadBuffer(function(err, buffer) {
      if(err) {
        console.error("Failed to read file upload buffer:", err);
        res.sendStatus(500);
        return;
      }

      storeFile(buffer);
    });
  };
};
