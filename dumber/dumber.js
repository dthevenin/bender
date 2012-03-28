(function(dumber)
{
  dumber.NS = "http://dumber.igel.co.jp";      // Dumber namespace
  dumber.NS_E = "http://dumber.igel.co.jp/e";  // Properties namespace
  dumber.NS_F = "http://dumber.igel.co.jp/f";  // Float properties namespace
  dumber.NS_B = "http://dumber.igel.co.jp/b";  // Boolean properties namespace

  // Create a Dumber context for the given target (document by default.)
  // Elements created in this context will be extended with the Dumber
  // prototypes.
  dumber.create_context = function(target)
  {
    if (!target) target = document;
    var doc = target.ownerDocument || target;
    var context = doc.implementation.createDocument(dumber.NS, "context", null);

    // Wrap all new elements
    context.createElement = function(name)
    {
      return wrap_element(Object.getPrototypeOf(this).createElementNS
        .call(this, dumber.NS, name));
    };
    context.createElementNS = function(ns, qname)
    {
      return wrap_element(Object.getPrototypeOf(this).createElementNS
        .call(this, ns, qname));
    };

    // The root is a context (i.e., component) element
    var root = wrap_element(context.documentElement);
    var loaded = {};      // loaded URIs
    var components = {};  // known components by URI/id
    loaded[normalize_url(doc.baseURI, "")] = root;

    // Keep track of uri/id pairs to find components with the href attribute
    context._add_component = function(component)
    {
      var uri = normalize_url(doc.baseURI,
          component._uri + "#" + component._id);
      components[uri] = component;
    };

    // Request for a component to be loaded. If the component was already
    // loaded, return the component node, otherwise return the boolean value
    // true to acknowledge the request. In that situation, a "@loaded" event
    // will be sent when loading has finished; an "@error" event will be sent in
    // case of error.
    context._load_component = function(url, use)
    {
      var split = url.split("#");
      var locator = normalize_url(doc.baseURI, split[0]);
      var id = split[1];
      if (typeof loaded[locator] === "object") {
        return id ? components[locator + "#" + id] : loaded[locator];
      } else {
        if (!loaded[locator]) {
          loaded[locator] = true;
          flexo.ez_xhr(locator, { responseType: "document" }, function(req) {
              if (!req.response) {
                flexo.notify(context, "@error", { url: url });
              } else {
                loaded[locator] = import_node(root,
                  req.response.documentElement, locator);
                flexo.notify(context, "@loaded",
                  { component: loaded[locator], url: url, use: use });
              }
            });
        }
        return true;
      }
    };

    // Manage the render queue specific to this context
    var render_queue = [];
    var timeout = null;
    context._refreshed_instance = function(instance)
    {
      flexo.remove_from_array(render_queue, instance);
    };
    context._refresh_instance = function(instance)
    {
      if (render_queue.indexOf(instance) < 0) {
        render_queue.push(instance);
        if (!timeout) {
          timeout = setTimeout(function() {
              flexo.log("refresh_instances×{0}".fmt(render_queue.length));
              while (render_queue.length > 0) {
                render_queue.shift().render_component_instance();
              }
              render_queue = [];
              timeout = null;
            }, 0);
        }
      }
    };

    root._target = target;
    return root;
  };

  // Prototype for a component instance. Prototypes may be extended through the
  // <script> element.
  var component_instance =
  {
    // Initialize the instance from a <use> element given a <component>
    // description node.
    init: function(use, component, parent, target)
    {
      this.use = use;
      this.component = component;
      this.target = target;
      this.views = {};       // rendered views by id
      this.uses = {};        // rendered uses by id
      this.rendered = [];    // root DOM nodes and use instances
      this.watchers = [];    // instances that have watches on this instance
      this.properties = {};  // watchable properties
      this.watched = {};     // watched properties
      Object.keys(component._properties).forEach(function(k) {
          if (!use._properties.hasOwnProperty(k)) {
            this.properties[k] = component._properties[k];
          }
        }, this);
      Object.keys(use._properties).forEach(function(k) {
          this.properties[k] = use._properties[k];
        }, this);
      component._instances.push(this);
      this.uses.$self = this;
      this.uses.$parent = parent;
      return this;
    },

    // Find the value of a property in scope
    // Create a new property on the top-level instance if not found
    find_instance_with_property: function(name)
    {
      if (this.properties.hasOwnProperty(name)) return this;
      if (this.uses.$parent) {
        return this.uses.$parent.find_instance_with_property(name);
      } else {
        this.properties[name] = undefined;
        return this;
      }
    },

    // Get or set a property in self or nearest ancestor
    property: function(name, value)
    {
      var instance = this.find_instance_with_property(name);
      if (value) {
        if (!instance) instance = this;
        instance.properties[name] = value;
      }
      if (instance) return instance.properties[name];
    },

    // Unrender, then render the view when the target is an Element.
    render_component_instance: function()
    {
      this.component.ownerDocument._refreshed_instance(this);
      this.unrender();
      if (flexo.root(this.use) !== this.use.ownerDocument) return;
      if (this.use._pending) this.target = this.use._pending.parentNode;
      if (this.target instanceof Element) {
        this.views.$document = this.target.ownerDocument;
        this.pending = 0;
        if (this.component._view) {
          this.render_children(this.component._view, this.target,
              this.use._pending);
        }
        this.update_title();
        if (this.pending === 0) this.render_watches();
        flexo.notify(this, "@rendered");
      }
    },

    render_watches: function()
    {
      this.component._watches.forEach(function(watch) {
          var instance = Object.create(watch_instance).init(watch, this);
          instance.render_watch_instance();
          this.rendered.push(instance);
        }, this);
      for (var p in this.watched) this.properties[p] = this.properties[p];
    },

    rendered_use: function(use)
    {
      if (use._instance) {
        this.rendered.push(use._instance);
        if (use._id) this.uses[use._id] = use._instance;
      } else {
        flexo.log("rendered_use: no instance for", use);
      }
    },

    render_use: function(use, dest, ref)
    {
      if (use._pending) {
        use._pending = temporary_node(dest, ref, use);
        ++this.pending;
        return;
      }
      var instance = use._render(dest, this);
      if (instance === true) {
        use._pending = temporary_node(dest, ref, use);
        ++this.pending;
        flexo.log("render_use: wait for {0} to load...".fmt(use._href));
        flexo.listen(use, "@loaded", (function() {
            flexo.log("... loaded", use);
            flexo.safe_remove(use._pending);
            delete use._pending;
            this.rendered_use(use);
            if (--this.pending === 0) this.render_watches();
          }).bind(this));
      } else if (instance) {
        this.rendered_use(use);
      }
    },

    render_children: function(node, dest, ref)
    {
      for (var ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 1) {
          if (ch.namespaceURI === dumber.NS) {
            if (ch.localName === "use") {
              this.render_use(ch, dest, ref);
            } else if (ch.localName === "target") {
              if (ch._once) {
                if (!ch._rendered) {
                  this.render_children(ch, ch._find_target(dest));
                  ch._rendered = true;
                }
              } else {
                this.render_children(ch, ch._find_target(dest));
              }
            } else if (ch.localName === "content") {
              this.render_children(this.use.childNodes.length > 0 ?
                this.use : ch, dest, ref);
            }
          } else {
            this.render_foreign(ch, dest, ref);
          }
        } else if (ch.nodeType === 3 || ch.nodeType === 4) {
          var d = dest.ownerDocument.createTextNode(ch.textContent);
          dest.insertBefore(d, ref);
          if (dest === this.target) this.rendered.push(d);
        }
      }
    },

    render_foreign: function(node, dest, ref)
    {
      var d = dest.ownerDocument.createElementNS(node.namespaceURI,
          node.localName);
      [].forEach.call(node.attributes, function(attr) {
          if ((attr.namespaceURI === flexo.XML_NS || !attr.namespaceURI) &&
            attr.localName === "id") {
            this.views[attr.value.trim()] = d;
          } else if (attr.namespaceURI &&
            attr.namespaceURI !== node.namespaceURI) {
            d.setAttributeNS(attr.namespaceURI, attr.localName, attr.value);
          } else {
            d.setAttribute(attr.localName, attr.value);
          }
        }, this);
      dest.insertBefore(d, ref);
      if (dest === this.target) {
        [].forEach.call(this.use.attributes, function(attr) {
            if (!(this.use._attributes.hasOwnProperty(attr.localName) ||
                attr.namespaceURI === dumber.NS_E ||
                attr.namespaceURI === dumber.NS_F ||
                attr.namespaceURI === dumber.NS_B)) {
              d.setAttribute(attr.name, attr.value);
            }
          }, this);
        this.rendered.push(d);
      }
      this.render_children(node, d);
    },

    unrender: function()
    {
      this.rendered.forEach(function(r) {
        if (r instanceof Node) {
          r.parentNode.removeChild(r);
        } else {
          flexo.remove_from_array(r.component._instances, r);
          r.unrender();
        }
      }, this);
      this.rendered = [];
    },

    update_title: function()
    {
      if (this.target instanceof Element && this.component.localName === "app"
          && this.use.parentNode === this.use.ownerDocument.documentElement &&
          this.component._title) {
        this.target.ownerDocument.title = this.component._title.textContent;
      }
    },

    watch_property: function(property, handler)
    {
      if (!(this.watched.hasOwnProperty(property))) {
        this.watched[property] = [];
        var p = this.properties[property];
        var that = this;
        flexo.getter_setter(this.properties, property, function() { return p; },
            function(p_) {
              var prev = p;
              p = p_;
              that.watched[property].slice().forEach(function(h) {
                  h.call(that, p, prev);
                });
            });
      }
      this.watched[property].push(handler);
      // flexo.log("watch_property[{0}]: {1}".fmt(property, this.watched[property].length));
    },

    unwatch_property: function(property, handler)
    {
      flexo.remove_from_array(this.watched[property], handler);
      // flexo.log("unwatch_property[{0}]: {1}".fmt(property, this.watched[property].length));
      if (this.watched[property] && this.watched[property].length === 0) {
        delete this.watched[property];
      }
    },
  };

  var watch_instance =
  {
    init: function(watch, component_instance)
    {
      this.watch = watch;
      this.component_instance = component_instance;
      this.component = this.component_instance.component;
      this.ungets = [];
      return this;
    },

    got: function(value)
    {
      this.watch._sets.forEach(function(set) {
          var val = set._action ?
            set._action.call(this.component_instance, value) : value;
          if (set._view) {
            var target = this.component_instance.views[set._view];
            if (!target) {
              flexo.log("No view for \"{0}\" in".fmt(set._view), set);
            } else {
              if (set._attr) {
                target.setAttribute(set._attr, val);
              } else {
                target[set._property || "textContent"] = val;
              }
            }
          } else if (set._property) {
            var target = set._use ? this.component_instance.uses[set._use] :
              this.component_instance
                .find_instance_with_property(set._property);
            if (!target) {
              flexo.log("(got) No use for \"{0}\" in".fmt(set._property), set);
            } else if (val !== undefined) {
              target.properties[set._property] = val;
            }
          }
        }, this);
    },

    render: function()
    {
      this.watch._gets.forEach(function(get) {
          var that = this;
          if (get._event) {
            var listener = function(e) {
              that.got((get._action || flexo.id)
                .call(that.component_instance, e));
            };
            if (get._view) {
              var target = this.component_instance.views[get._view];
              if (!target) {
                flexo.log("No view for \"{0}\" in".fmt(get._view), get);
              } else {
                target.addEventListener(get._event, listener, false);
                this.ungets.push(function() {
                    target.removeEventListener(get._event, listener, false);
                  });
              }
            } else if (get._use) {
              var target = this.component_instance.uses[get._use];
              if (!target) {
                flexo.log("(render get/use) No use for \"{0}\" in"
                  .fmt(get._use), get);
              } else {
                flexo.listen(target, get._event, listener);
                this.ungets.push(function() {
                    flexo.unlisten(target, get._event, listener);
                  });
              }
            }
          } else if (get._property) {
            var target = get._use ? this.component_instance.uses[get._use] :
              this.component_instance
                .find_instance_with_property(get._property);
            if (!target) {
              flexo.log("(render get/property) No use for \"{0}\""
                  .fmt(get._property));
            } else {
              var h = function(p, prev)
              {
                that.got((get._action || flexo.id)
                    .call(that.component_instance, p, prev));
              };
              h._watch = this;
              target.watch_property(get._property, h);
              this.ungets.push(function() {
                  target.unwatch_property(get._property, h);
                });
            }
          }
        }, this);
    },

    unrender: function()
    {
      this.ungets.forEach(function(unget) { unget(); });
    }
  };

  var prototypes =
  {
    "":
    {
      appendChild: function(ch) { return this.insertBefore(ch, null); },

      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        this._refresh();
        return ch;
      },

      removeChild: function(ch)
      {
        var parent = this.parentNode;
        Object.getPrototypeOf(this).removeChild.call(this, ch);
        this._refresh(parent);
        return ch;
      },

      setAttribute: function(name, value)
      {
        Object.getPrototypeOf(this).setAttribute.call(this, name, value);
        this._refresh();
      },

      setAttributeNS: function(ns, name, value)
      {
        Object.getPrototypeOf(this).setAttributeNS.call(this, ns, name, value);
        this._refresh();
      },

      _textContent: function(t)
      {
        this.textContent = t;
        this._refresh();
      },

      $: function(name)
      {
        var argc = 1;
        var attrs = {};
        if (typeof arguments[1] === "object" &&
            !(arguments[1] instanceof Node)) {
          argc = 2;
          attrs = arguments[1];
        }
        var m = name.match(
            // 1: prefix 2: name  3: classes    4: id        5: more classes
            /^(?:(\w+):)?([\w\-]+)(?:\.([^#]+))?(?:#([^.]+))?(?:\.(.+))?$/
          );
        if (m) {
          var ns = m[1] && flexo[m[1].toUpperCase() + "_NS"];
          var elem = ns ? this.ownerDocument.createElementNS(ns, m[2]) :
            this.ownerDocument.createElement(m[2]);
          var classes = m[3] ? m[3].split(".") : [];
          if (m[5]) [].push.apply(classes, m[5].split("."));
          if (m[4]) attrs.id = m[4];
          if (classes.length > 0) {
            attrs["class"] =
              (attrs.hasOwnProperty("class") ? attrs["class"] + " " : "") +
              classes.join(" ");
          }
          for (a in attrs) {
            if (attrs.hasOwnProperty(a) &&
                attrs[a] !== undefined && attrs[a] !== null) {
              var split = a.split(":");
              ns = split[1] && (dumber["NS_" + split[0].toUpperCase()] ||
                  flexo[split[0].toUpperCase() + "_NS"]);
              if (ns) {
                elem.setAttributeNS(ns, split[1], attrs[a]);
              } else {
                elem.setAttribute(a, attrs[a]);
              }
            }
          }
          [].slice.call(arguments, argc).forEach(function(ch) {
              if (typeof ch === "string") {
                elem.insertBefore(this.ownerDocument.createTextNode(ch));
              } else if (ch instanceof Node) {
                elem.insertBefore(ch);
              }
            }, this);
          return elem;
        }
      },

      _refresh: function(parent)
      {
        if (!parent) parent = this.parentNode;
        var component = component_of(parent);
        if (component) {
          component._instances.forEach(function(i) {
              component.ownerDocument._refresh_instance(i);
            });
        }
      },

      _serialize: function()
      {
        return (new XMLSerializer).serializeToString(this);
      }
    },

    component:
    {
      _init: function()
      {
        this._components = {};  // child components
        this._watches = [];     // child watches
        this._instances = [];   // instances of this component
        this._properties = {};  // properties map
        this._uri = "";
        flexo.getter_setter(this, "_is_component", function() { return true; });
      },

      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        if (ch.namespaceURI === dumber.NS) {
          if (ch.localName === "app" || ch.localName === "component") {
            this._add_component(ch);
          } else if (ch.localName === "desc") {
            if (this._desc) {
              Object.getPrototypeOf(this).removeChild.call(this, this._desc);
            }
            this._desc = ch;
          } else if (ch.localName === "script") {
            ch._run();
          } else if (ch.localName === "title") {
            if (this._title) {
              Object.getPrototypeOf(this).removeChild.call(this, this._title);
            }
            this._title = ch;
            this._instances.forEach(function(i) { i.update_title(); });
          } else if (ch.localName === "view") {
            if (this._view) {
              Object.getPrototypeOf(this).removeChild.call(this, this._view);
            }
            this._view = ch;
            this._refresh();
          } else if (ch.localName === "use") {
            this._insert_use(ch);
          } else if (ch.localName === "watch") {
            this._watches.push(ch);
            this._refresh();
          }
        }
        return ch;
      },

      _insert_use: function(use)
      {
        var instance = use._render(this._target);
        if (instance === true) {
          flexo.log("insertBefore: wait for {0} to load...".fmt(use._href));
          flexo.listen(use, "@loaded", (function(e) {
              flexo.log("... loaded", e.instance);
              this._instances.push(e.instance);
            }).bind(this));
        } else if (instance) {
          this._instances.push(instance);
        }
      },

      removeChild: function(ch)
      {
        Object.getPrototypeOf(this).removeChild.call(this, ch);
        if (ch._id && this._components[ch._id]) {
          delete this._components[ch._id];
        } else if (ch === this._desc) {
          delete this._desc;
        } else if (ch === this._title) {
          delete this._title;
        } else if (ch === this._view) {
          delete this._view;
          this._refresh();
        } else if (ch._unrender) {
          flexo.remove_from_array(this._instances, ch._instance);
          ch._unrender();
        }
        // TODO watch?
        return ch;
      },

      setAttribute: function(name, value)
      {
        if (name === "id") {
          this._id = value.trim();
          if (this.parentNode && this.parentNode._add_component) {
            this.parentNode._add_component(this);
          }
        }
        Object.getPrototypeOf(this).setAttribute.call(this, name, value);
      },

      // TODO support xml:id?
      setAttributeNS: function(ns, name, value)
      {
        if (ns === dumber.NS_E) {
          this._properties[name] = value;
        } else if (ns === dumber.NS_F) {
          this._properties[name] = parseFloat(value);
        } else if (ns === dumber.NS_B) {
          this._properties[name] = value.trim().toLowerCase() === "true";
        }
        Object.getPrototypeOf(this).setAttributeNS.call(this, ns, name, value);
      },

      _add_component: function(component)
      {
        if (component._id) {
          // TODO check for duplicate id
          this._components[component._id] = component;
          this.ownerDocument._add_component(component);
        }
      },
    },

    get:
    {
      _init: function()
      {
        flexo.getter_setter(this, "_content",
            function() { return this._action; },
            function(f) { if (typeof f === "function") this._action = f; });
        return this;
      },

      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        if (ch.nodeType === 3 || ch.nodeType === 4) this._update_action();
        return ch;
      },

      setAttribute: function(name, value)
      {
        Object.getPrototypeOf(this).setAttribute.call(this, name, value);
        if (name === "event" || name === "property" ||
            name === "use" || name === "view") {
          this["_" + name] = value.trim();
        }
      },

      _textContent: function(t)
      {
        this.textContent = t;
        this._update_action();
      },

      _update_action: function()
      {
        if (/\S/.test(this.textContent)) {
          // TODO handle errors
          this._action = new Function("value", this.textContent);
        } else {
          delete this._action;
        }
      }
    },

    script:
    {
      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        if (ch.nodeType === 3 || ch.nodeType === 4) this._run();
        return ch;
      },

      // TODO setAttribute: href for script file location

      _textContent: function(t)
      {
        this.textContent = t;
        this._run();
      },

      _run: function()
      {
        if (!this.parentNode || this._ran || !/\S/.test(this.textContent)) {
          return;
        }
        if (!this.parentNode._prototype) {
          this.parentNode._prototype = Object.create(component_instance);
        }
        (new Function(this.textContent)).call(this.parentNode);
        this._ran = true;
      }
    },

    set:
    {
      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        if (ch.nodeType === 3 || ch.nodeType === 4) this._update_action();
        return ch;
      },

      setAttribute: function(name, value)
      {
        Object.getPrototypeOf(this).setAttribute.call(this, name, value);
        if (name === "attr" || name === "property" ||
            name === "use" || name === "view") {
          this["_" + name] = value.trim();
        }
      },

      _textContent: function(t)
      {
        this.textContent = t;
        this._update_action();
      },

      _update_action: function()
      {
        if (/\S/.test(this.textContent)) {
          // TODO handle errors
          this._action = new Function("value", this.textContent);
        } else {
          delete this._action;
        }
      }
    },

    target:
    {
      setAttribute: function(name, value)
      {
        Object.getPrototypeOf(this).setAttribute.call(this, name, value);
        if (name === "q" || name === "ref") {
          this["_" + name] = value.trim();
          this._refresh();
        } else if (name === "once") {
          this._once = value.trim().toLowerCase() === "true";
          this._refresh();
        }
      },

      _find_target: function(dest)
      {
        if (this._q) {
          return dest.ownerDocument.querySelector(this._q);
        } else if (this._ref) {
          return dest.ownerDocument.getElementById(this._ref);
        } else {
          return dest;
        }
      }
    },

    use:
    {
      _init: function()
      {
        this._properties = {};
      },

      // Attributes interpreted by use
      _attributes: { href: true, id: true, q: true, ref: true },

      setAttribute: function(name, value)
      {
        Object.getPrototypeOf(this).setAttribute.call(this, name, value);
        if (this._attributes.hasOwnProperty(name)) {
          this["_" + name] = value.trim();
        }
        this._refresh();
      },

      setAttributeNS: function(ns, name, value)
      {
        if (ns === dumber.NS_E) {
          this._properties[name] = value;
        } else if (ns === dumber.NS_F) {
          this._properties[name] = parseFloat(value);
        } else if (ns === dumber.NS_B) {
          this._properties[name] = value.trim().toLowerCase() === "true";
        }
        Object.getPrototypeOf(this).setAttributeNS.call(this, ns, name, value);
      },

      _find_component: function()
      {
        var component = undefined;
        if (this._ref) {
          var parent_component = component_of(this);
          while (!component && parent_component) {
            component = parent_component._components[this._ref];
            parent_component = component_of(parent_component.parentNode);
          }
          return component;
        } else if (this._q) {
          return this.parentNode && this.parentNode.querySelector(this._q);
        } else if (this._href) {
          var href =
            (this._href.indexOf("#") === 0 ? component_of(this)._uri : "") +
            this._href;
          return this.ownerDocument._load_component(href, this);
        }
      },

      _render: function(target, parent)
      {
        var component = this._find_component();
        if (component === true) {
          this.__target = target;
          this.__parent = parent;
          if (this.__loading) return;
          this.__loading = (function(e) {
            if (e.use === this) {
              flexo.log("... loaded {0} for".fmt(e.url), this, this.__target);
              flexo.notify(this, "@loaded", { instance: this
                ._render_component(e.component, this.__target, this.__parent) });
              flexo.unlisten(this.ownerDocument, "@loaded", this.__loading);
              delete this.__loading;
              delete this.__target;
              delete this.__parent;
            }
          }).bind(this);
          flexo.listen(this.ownerDocument, "@loaded", this.__loading);
          return true;
        } else if (component) {
          return this._render_component(component, target, parent);
        } else {
          flexo.log("No component for", this);
        }
      },

      _render_component: function(component, target, parent)
      {
        this._component = component;
        this._instance = render_component(component, target, this, parent);
        return this._instance;
      },

      _unrender: function()
      {
        if (this._instance) {
          this._instance.unrender();
          delete this._instance;
        }
      },
    },

    view:
    {
      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        if (ch.namespaceURI === dumber.NS) {
          if (ch.localName === "use") {
            this._refresh();
          }
        } else {
          this._refresh();
        }
        return ch;
      },

      removeChild: function(ch)
      {
        Object.getPrototypeOf(this).removeChild.call(this, ch);
        this._refresh();
        return ch;
      },
    },

    watch:
    {
      _init: function()
      {
        this._gets = [];
        this._sets = [];
        this._watches = [];
      },

      insertBefore: function(ch, ref)
      {
        Object.getPrototypeOf(this).insertBefore.call(this, ch, ref);
        if (ch.namespaceURI === dumber.NS) {
          if (ch.localName === "get") {
            this._gets.push(ch);
          } else if (ch.localName === "set") {
            this._sets.push(ch);
          } else if (ch.localName === "watch") {
            this._watches.push(ch);
          }
        }
      },
    }
  };

  // Specific functions to create get, set and script attributes with an actual
  // function rather than a string to create a function for the action
  ["get", "set", "script"].forEach(function(name) {
      prototypes.component["$" + name] = function(attrs, action)
      {
        var elem = action ? this.$(name, attrs) : this.$(name);
        elem._action = action || attrs;
        return elem;
      };
    });

  prototypes.app = prototypes.component;
  prototypes.context = prototypes.component;

  // The component of a node is itself if it is a component node (or app or
  // context), or the component of its parent
  function component_of(node)
  {
    return node ? node._is_component ? node : component_of(node.parentNode) :
      null;
  }

  function import_node(parent, node, uri)
  {
    if (node.nodeType === 1) {
      var n = parent.ownerDocument
        .createElementNS(node.namespaceURI, node.localName);
      if (n._is_component) n._uri = uri;
      parent.appendChild(n);
      for (var i = 0, m = node.attributes.length; i < m; ++i) {
        var attr = node.attributes[i];
        if (attr.namespaceURI) {
          if (attr.namespaceURI === flexo.XMLNS_NS &&
              attr.localName !== "xmlns") {
            n.setAttribute("xmlns:{0}".fmt(attr.localName), attr.nodeValue);
          } else {
            n.setAttributeNS(attr.namespaceURI, attr.localName, attr.nodeValue);
          }
        } else {
          n.setAttribute(attr.localName, attr.nodeValue);
        }
      }
      for (var ch = node.firstChild; ch; ch = ch.nextSibling) {
        import_node(n, ch, uri);
      }
      return n;
    } else if (node.nodeType === 3 || node.nodeType === 4) {
      var n = parent.ownerDocument.importNode(node, false);
      parent.appendChild(n);
    }
  }

  function normalize_url(base, ref)
  {
    var url = flexo.split_uri(flexo.absolute_uri(base, ref)
      .replace(/%([0-9a-f][0-9a-f])/gi,
        function(m, n) {
          n = parseInt(n, 16);
          return (n >= 0x41 && n <= 0x5a) || (n >= 0x61 && n <= 0x7a) ||
            (n >= 0x30 && n <= 0x39) || n === 0x2d || n === 0x2e ||
            n === 0x5f || n == 0x7e ? String.fromCharCode(n) : m.toUpperCase();
        }));
    if (url.scheme) url.scheme = url.scheme.toLowerCase();
    if (url.authority) url.authority = url.authority.toLowerCase();
    return flexo.unsplit_uri(url);
  }

  function render_component(component, target, use, parent)
  {
    var instance = Object.create(component._prototype || component_instance)
      .init(use, component, parent, target);
    if (instance.instantiated) instance.instantiated();
    use.ownerDocument._refresh_instance(instance);
    return instance;
  }

  function temporary_node(dest, ref, use)
  {
    flexo.safe_remove(use._pending);
    var pending = dest.ownerDocument.createComment(use._href);
    dest.insertBefore(pending, ref);
    return pending;
  }

  // Extend an element with Dumber methods and call the _init() method on the
  // node if it exists.
  function wrap_element(e)
  {
    var proto = prototypes[e.localName] || {};
    for (var p in proto) e[p] = proto[p];
    for (var p in prototypes[""]) {
      if (!e.hasOwnProperty(p)) e[p] = prototypes[""][p];
    }
    if (e._init) e._init();
    return e;
  }

})(typeof exports === "object" ? exports : this.dumber = {});
