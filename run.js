// Get args from the URL
function get_args(defaults, argstr)
{
  var args = flexo.get_args(defaults, argstr);
  bender.DEBUG_LEVEL = parseFloat(args.debug);
  return args;
}

// Open a file from a URL
function open_url(args)
{
  flexo.request_uri(args.app, function(req) {
      document.body.innerHTML = "";
      var context = bender.create_context(document, args.app);
      var app = context["import"](req.responseXML.documentElement);
      app.addEventListener("@loaded", function() {
          var instance = app.instantiate();
          if (instance.render(document.body, true)) {
            bender.log("Rendered, initializing...");
            instance.init_properties();
            for (var a in args) {
              if (args.hasOwnProperty(a)) {
                if (a.substr(0, 2) === "e:") {
                  prop_name = "$" + flexo.undash(a.substr(2));
                  instance[prop_name] = args[a];
                } else if (a.substr(0, 2) === "f:") {
                  prop_name = "$" + flexo.undash(a.substr(2));
                  instance[prop_name] = parseFloat(args[a]);
                } else if (a.substr(0, 2) === "b:") {
                  prop_name = "$" + flexo.undash(a.substr(2));
                  instance[prop_name] = flexo.is_true(args[a]);
                } else if (a.substr(0, 1) === "$") {
                  instance[a] = args[a];
                }
              }
            }
            flexo.notify(instance, "@ready");
          }
        }, false);
    });
}

var ARGS = get_args();
if (ARGS.app) open_url(ARGS);
