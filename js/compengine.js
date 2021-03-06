/**
 * @file Component-based micro-engine, partially implements ECS pattern (Entity-Component-System)
 * @author Adam Vesecky <vesecky.adam@gmail.com>
 */

const MSG_OBJECT_ADDED = 1;
const MSG_OBJECT_REMOVED = 2;

const STATE_INACTIVE = 0;
const STATE_UPDATABLE = 2 ^ 0;
const STATE_DRAWABLE = 2 ^ 1;
const STATE_LISTENING = 2 ^ 2;

// unit size in px - all attributes are calculated against this size
var UNIT_SIZE = 1;


// Scene that keeps collection of all game
// objects and calls draw and update upon them
class Scene {

	constructor(canvas) {
		if (Scene.scene) {
			return Scene.scene;
		}

		Scene.scene = this;

		/**
         * Link to canvas
         * @type {Canvas}
         */
		this.canvas = canvas;
		/**
         * Link to canvas rendering context
         * @type {CanvasRenderingContext2D}
         */
		this.canvasCtx = canvas.getContext('2d');

		this.clearScene();
	}

	submitChanges() {
		// submit upon the root recursively
		this.root.submitChanges(true);
	}

	// stores a new function that should be invoked after given amount of time
	addPendingInvocation(delay, action) {
		this.pendingInvocations.push({
			delay: delay,
			time: 0,
			action: action
		});
	}

	addGlobalComponent(cmp) {
		this.root.addComponent(cmp);
	}

	removeGlobalComponent(cmp) {
		this.root.removeComponent(cmp);
	}

	addGlobalGameObject(obj) {
		this.root.addGameObject(obj);
	}

	removeGlobalGameObject(obj) {
		this.root.removeGameObject(obj);
	}

	// adds a new global attribute
	addGlobalAttribute(key, val) {
		this.root.addAttribute(key, val);
	}

	// gets a global attribute by its key
	getGlobalAttribute(key) {
		return this.root.getAttribute(key);
	}

	// removes a global attribute by its key
	removeGlobalAttribute(key) {
		this.root.removeAttribute(key);
	}

	// finds all game objects by their tag
	findAllObjectsByTag(tag) {
		let result = new Array();
		if (this.gameObjectTags.has(tag)) {
			for (let [key, gameObject] of this.gameObjectTags.get(tag)) {
				result.push(gameObject);
			}
		}

		return result;
	}

	/**
	 * Finds a first object with a given tag
	 * @param {String} tag
	 * @returns {GameObject} 
	 */
	findFirstObjectByTag(tag) {
		if (this.gameObjectTags.has(tag)) {
			for (let [key, gameObject] of this.gameObjectTags.get(tag)) {
				return gameObject; // return the first one
			}
		}
		return null;
	}

	findObjectBySecondaryId(id) {
		if (this.gameObjectSecIds.has(id)) {
			return this.gameObjectSecIds.get(id);
		}
		return null;
	}

	findAllObjectsByFlag(flag) {
		let result = new Array();
		for (let [key, gameObject] of this.gameObjects) {
			if (gameObject.hasFlag(flag)) {
				result.push(gameObject);
			}
		}
		return result;
	}

	findFirstObjectByFlag(flag) {
		for (let [key, gameObject] of this.gameObjects) {
			if (gameObject.hasFlag(flag)) {
				return gameObject;
			}
		}
	}

	// clears the whole scene, all game objects, attributes and components
	clearScene() {
		if (this.gameObjects !== undefined) {
			// call the finalization function
			for (let [key, gameObj] of this.gameObjects) {
				for (let component of gameObj.components) {
					component.finalize();
				}
			}
		}

		this.root = new GameObject("root");
		this.root.scene = this;

		// message action keys and all subscribers that listens to all these actions
		this.subscribers = new Map();
		// component ids and list of all actions they listen to
		this.subscribedMessages = new Map();
		// collection of all game objects, mapped by their tag and then by their ids
		this.gameObjectTags = new Map();
		// collection of all game objects, mapped by their ids
		this.gameObjects = new Map();
		// collection of all game object, mapped by their secondary ids
		this.gameObjectSecIds = new Map();

		// game objects sorted by z-index, used for drawing
		this.sortedObjects = new Array();

		// functions that should be invoked with some delay
		this.pendingInvocations = new Array();
	}

	// executes the update cycle
	update(delta, absolute) {
		// update
		this.root.update(delta, absolute);
		this.submitChanges(false);

		// execute pending invocations
		var i = this.pendingInvocations.length;
		while (i--) {
			let invocation = this.pendingInvocations[i];
			invocation.time += delta;

			if (invocation.time >= invocation.delay) {
				invocation.action();
				this.pendingInvocations.splice(i, 1);
			}
		}
	}

	// executes the draw cycle
	draw() {
		for (let gameObject of this.sortedObjects) {
			gameObject.draw(this.canvasCtx);
		}
	}

	sendmsg(action, data){
		this._sendmsg(new Msg(action, null, null, data));
	}

	// sends message to all subscribers
	_sendmsg(msg) {
		if (this.subscribers.has(msg.action)) {
			// get all subscribed components
			let subscribedComponents = this.subscribers.get(msg.action);
			for (let [key, component] of subscribedComponents) {
				// send message
				if (component.owner.state & STATE_LISTENING == STATE_LISTENING) {
					component.onmessage(msg);
				}
			}
		}
	}


	// subscribes given component for messaging system
	_subscribeComponent(msgKey, component) {
		var subs = this.subscribers.get(msgKey);
		if (subs === undefined) {
			subs = new Map();
			this.subscribers.set(msgKey, subs);
		}

		subs.set(component.id, component);

		// save into the second collection as well
		if (!this.subscribedMessages.has(component.id)) {
			this.subscribedMessages.set(component.id, new Array());
		}

		this.subscribedMessages.get(component.id).push(msgKey);
	}

	_addGameObject(obj) {
		// fill all collections
		if (!this.gameObjectTags.has(obj.tag)) {
			this.gameObjectTags.set(obj.tag, new Map());
		}

		this.gameObjectTags.get(obj.tag).set(obj.id, obj);
		this.gameObjects.set(obj.id, obj);
		this.gameObjectSecIds.set(obj.secondaryId, obj);

		// keep the third collection sorted by z-index
		let fnd = this.sortedObjects.binaryFind(obj, (current, search) => {
			if (current.zIndex == search.zIndex)
				return 0;
			else if (current.zIndex > search.zIndex)
				return 1;
			else
				return -1;
		});

		this.sortedObjects.splice(fnd.index, 0, obj);

		// notify subscribers that a new object has been added to the scene
		this._sendmsg(new Msg(MSG_OBJECT_ADDED, null, obj));
	}

	// immediately removes a given game object
	_removeGameObject(obj) {
		this.gameObjectTags.get(obj.tag).delete(obj.id);
		this.gameObjectSecIds.delete(obj.secondaryId);
		this.gameObjects.delete(obj.id);

		for (let i = 0; i < this.sortedObjects.length; i++) {
			if (this.sortedObjects[i].id == obj.id) {
				this.sortedObjects.splice(i, 1);
				break;
			}
		}
		// send message that the game object has been removed
		this._sendmsg(new Msg(MSG_OBJECT_REMOVED, null, obj));
	}


	_removeComponent(component) {
		this.subscribedMessages.delete(component.id);

		if (this.subscribedMessages.has(component.id)) {
			let allMsgKeys = this.subscribedMessages.get(component.id);
			for (let msgKey of allMsgKeys) {
				this.subscribers.get(msgKey).delete(component.id);
			}
		}
	}
}

// bit array for flags
class Flags {
	constructor() {
		// flag array 0-128
		this.flags1 = 0;
		this.flags2 = 0;
		this.flags3 = 0;
		this.flags4 = 0;
	}

	hasFlag(flag) {
		let index = this._getFlagIndex(flag);
		let offset = this._getFlagOffset(flag);
		let binary = 1 << offset;

		if (index <= 3) {
			switch (index) {
				case 0: return (this.flags1 & binary) == binary;
				case 1: return (this.flags2 & binary) == binary;
				case 2: return (this.flags3 & binary) == binary;
				case 3: return (this.flags4 & binary) == binary;
			}
		} else {
			throw new Error("Flag values beyond 128 are not supported");
		}
	}

	switchFlag(flag1, flag2) {
		let hasFlag2 = this.hasFlag(flag2);

		if (this.hasFlag(flag1)) this.setFlag(flag2);
		else this.resetFlag(flag2);

		if (hasFlag2) this.setFlag(flag1);
		else this.resetFlag(flag1);
	}

	setFlag(flag) {
		this._changeFlag(true, flag);
	}

	resetFlag(flag) {
		this._changeFlag(false, flag);
	}

	_getFlagIndex(flag) {
		return parseInt(flag / 32); // sizeof 32bit int
	}

	_getFlagOffset(flag) {
		return flag % 32; // sizeof 32bit int
	}

	_changeFlag(set, flag) {
		let index = this._getFlagIndex(flag);
		let offset = this._getFlagOffset(flag);
		let binary = 1 << offset;

		if (index <= 3) {
			switch (index) {
				case 0: if (set) (this.flags1 |= binary); else (this.flags1 &= ~binary);
				case 1: if (set) (this.flags2 |= binary); else (this.flags2 &= ~binary);
				case 2: if (set) (this.flags3 |= binary); else (this.flags3 &= ~binary);
				case 3: if (set) (this.flags4 |= binary); else (this.flags4 &= ~binary);
			}
		} else {
			throw new Error("Flag values beyond 128 are not supported");
		}
	}
}

// simple bounding box
class BBox {
	constructor() {
		/**
         * TopLeft absolute coordinate on X axis
         * @type {number}
         */
		this.topLeftX = 0;
		/**
         * TopLeft absolute coordinate on Y axis
         * @type {number}
         */
		this.topLeftY = 0;
		/**
         * BottomRight coordinate on X axis
         * @type {number}
         */
		this.bottomRightX = 0;
		/**
         * BottomRight coordinate on Y axis
         * @type {number}
         */
		this.bottomRightY = 0;
	}

	getSize() {
		return { width: (this.bottomRightX - this.topLeftX), height: (this.bottomRightY - this.topLeftY) };
	}

	getCenter() {
		let size = this.getSize();
		return { posX: (this.topLeftX + size.width / 2), posY: (this.topLeftY + size.height / 2) };
	}

	intersects(other, tolerance = 0) {
		return this.horizontalIntersection(other) >= -tolerance && this.verticalIntersection(other) >= -tolerance;
	}

	horizontalIntersection(other) {
		return Math.min(other.bottomRightX, this.bottomRightX) - Math.max(other.topLeftX, this.topLeftX);
	}

	verticalIntersection(other) {
		return Math.min(other.bottomLeftY, this.bottomLeftY) - Math.max(other.topLeftY, this.topLeftY);
	}
}

class Mesh {
	constructor(width, height) {
		/**
         * Relative width of the mesh 
         * @type {number}
         */
		this.width = width;
		/**
         * Relative height of the mesh
         * @type {number}
         */
		this.height = height;
		/**
         * Bounding box
         * @type {BBox}
         */
		this.bbox = new BBox();
	}

	_updateTransform(trans) {
		this._updateBoundingBox(trans);
	}

	_updateBoundingBox(trans) {
		if (trans.absRotation != 0) {
			let boxWidth = this.width * Math.abs(Math.cos(trans.absRotation)) + this.height * Math.abs(Math.sin(trans.absRotation));
			let boxHeight = this.height * Math.abs(Math.cos(trans.absRotation)) + this.width * Math.abs(Math.sin(trans.absRotation));

			let parentTrans = trans;

			let absPosX = parentTrans.absPosX - parentTrans.rotationOffsetX + this.width/2;
			let absPosY = parentTrans.absPosY - parentTrans.rotationOffsetY + this.height/2;
			let distX = (absPosX  - parentTrans.absPosX);
			let distY = (absPosY  - parentTrans.absPosY);
			let length = Math.sqrt(distX * distX + distY * distY);
			
			let angle = parentTrans.absRotation + Math.atan2(distY, distX);
			let rotPosX = length * Math.cos(angle);
			let rotPosY = length * Math.sin(angle);

			absPosX = parentTrans.absPosX + rotPosX;
			absPosY = parentTrans.absPosY + rotPosY;

			this.bbox.topLeftX = absPosX - boxWidth/2;
			this.bbox.topLeftY = absPosY - boxHeight/2;
			this.bbox.bottomRightX = this.bbox.topLeftX + boxWidth;
			this.bbox.bottomRightY = this.bbox.topLeftY + boxHeight;
		} else {
			this.bbox.topLeftX = trans.absPosX - trans.rotationOffsetX;
			this.bbox.topLeftY = trans.absPosY - trans.rotationOffsetY;
			this.bbox.bottomRightX = this.bbox.topLeftX + this.width;
			this.bbox.bottomRightY = this.bbox.topLeftY + this.height;
		}
	}
}

class RectMesh extends Mesh {
	constructor(fillStyle, width, height) {
		super(width, height);
		this.fillStyle = fillStyle;
	}
}

class ImageMesh extends Mesh {
	constructor(image, scene) {
		super(image.width / UNIT_SIZE, image.height / UNIT_SIZE);
		this.image = image;
	}
}

class SpriteMesh extends Mesh {
	constructor(offsetX, offsetY, width, height, image) {
		super(width, height);
		this.offsetX = offsetX;
		this.offsetY = offsetY;
		this.image = image;
	}
}

class MultiSprite extends SpriteMesh {
	constructor(id, trans, offsetX, offsetY, width, height, image) {
		super(offsetX, offsetY, width, height, image);
		this.id = id;
		this.trans = trans;
	}

	_updateTransform(parentTrans) {
		super._updateTransform(parentTrans);
		this.trans._updateTransform(parentTrans);
	}
}

class MultiSpriteCollection extends Mesh {
	constructor(atlas) {
		super(1, 1);
		this.atlas = atlas;
		this.sprites = new Map();
	}

	addSprite(sprite) {
		if (!sprite instanceof MultiSprite) {
			throw new Error("Sprite must be instance of MultiSprite class");
		}

		this.sprites.set(sprite.id, sprite);
	}

	_updateTransform(parentTrans) {
		super._updateTransform(parentTrans);

		for (let sprite of this.sprites) {
			sprite.trans._updateTransform(parentTrans);

			this.bbox.topLeftX = Math.min(this.bbox.topLeftX, sprite.bbox.topLeftX);
			this.bbox.topLeftY = Math.min(this.bbox.topLeftY, sprite.bbox.topLeftY);
			this.bbox.bottomRightX = Math.max(this.bbox.bottomRightX, sprite.bbox.bottomRightX);
			this.bbox.bottomRightY = Math.max(this.bbox.bottomRightY, sprite.bbox.bottomRightY);
		}

		let size = this.bbox.getSize().width;
		this.width = size.width;
		this.height = size.height;

	}
}

// transformation entity
class Trans {
	constructor(posX = 0, posY = 0, rotation = 0, rotationOffsetX = 0, rotationOffsetY = 0) {
		/**
         * Relative position on X axis
         * @type {number}
         */
		this.posX = posX;
		/**
         * Relative position on Y axis
         * @type {number}
         */
		this.posY = posY;
		/**
         * Relative rotation
         * @type {number}
         */
		this.rotation = rotation;
		/**
         * Rotation offset on X axis
         * @type {number}
         */
		this.rotationOffsetX = rotationOffsetX;
		/**
         * Rotation offset on Y axis
         * @type {number}
         */
		this.rotationOffsetY = rotationOffsetY;

		/**
         * Absolute position on X axis
         * @type {number}
         */
		this.absPosX = 0;
		/**
         * Absolute position on Y axis
         * @type {number}
         */
		this.absPosY = 0;
		/**
         * Absolute rotation
         * @type {number}
         */
		this.absRotation = 0;
	}

	setPosition(posX, posY) {
		this.posX = posX;
		this.posY = posY;
	}

	_updateTransform(parentTrans) {

		if (parentTrans != null) {

			this.absPosX = this.posX + parentTrans.absPosX;
			this.absPosY = this.posY + parentTrans.absPosY;
			this.absRotation = this.rotation + parentTrans.absRotation;

			if (parentTrans.absRotation != 0) {

				let distX = (this.absPosX - (parentTrans.absPosX));
				let distY = (this.absPosY - (parentTrans.absPosY));

				let length = Math.sqrt(distX * distX + distY * distY);
				// always use atan2 if you don't want to deal with cos/sin freaking signs
				let angle = parentTrans.absRotation + Math.atan2(distY, distX);
				let rotPosX = length * Math.cos(angle);
				let rotPosY = length * Math.sin(angle);
				this.absPosX = parentTrans.absPosX + rotPosX;
				this.absPosY = parentTrans.absPosY + rotPosY;
			}
		} else {
			this.absPosX = this.posX;
			this.absPosY = this.posY;
			this.absRotation = this.rotation;
		}
	}
}

/**
 * Game object entity that aggregates generic attributes and components
 * Overall behavior of the game entity is defined by its components
 */
class GameObject {

	constructor(tag, secondaryId = -10000) {
		/**
         * Primary identifier, set automatically
         * @type {number}
         */
		this.id = GameObject.idCounter++;
		/**
         * Secondary identifier
         * @type {number}
         */
		this.secondaryId = secondaryId;
		/**
         * Name
         * @type {string}
         */
		this.tag = tag;
		/**
         * Parent game object
         * @type {GameObject}
         */
		this.parent = null;
		/**
         * List of inner components
         * @type {Array<Component>}
         */
		this.components = new Array();
		/**
         * Z-Index
         * @type {number}
         */
		this.zIndex = 0;
		/**
         * Rendering entity
         * @type {Mesh}
         */
		this.mesh = new Mesh(0, 0);
		/**
         * Game scene
         * @type {Scene}
         */
		this.scene = null;
		/**
         * Transformation entity
         * @type {Trans}
         */
		this.trans = new Trans();
		/**
         * Object states
         * @type {number}
         */
		this.state = STATE_DRAWABLE | STATE_LISTENING | STATE_UPDATABLE;
		/**
         * List of attributes, mapped by their ids
         * @type {Map<number, Any>}
         */
		this.attributes = new Map();

		// temporary collection that keeps objects for removal -> objects should be removed
		// at the end of the update cycle since we are sure there aren't any running components
		this.objectsToRemove = new Array();
		this.componentsToRemove = new Array();
		// temporary collection that keeps objects for adding -> objects should be added
		// at the end of the update cycle since we are sure there aren't any running components
		this.objectsToAdd = new Array();
		this.componentsToAdd = new Array();

		this.children = new Map();
	}

	submitChanges(recursively = false) {

		this._addPendingGameObjects(!recursively);

		// add game objects first 
		if (recursively) {
			for (let [key, val] of this.children) {
				val._addPendingGameObjects();
			}
		}

		// components should be added after all game objects
		this._addPendingComponents();

		this._removePendingComponents();
		this._removePendingGameObjects(!recursively);

		// update other collections
		if (recursively) {
			for (let [key, val] of this.children) {
				val._addPendingComponents();
				val._removePendingComponents();
				val._removePendingGameObjects(true);
			}
		}
	}

	addState(state) {
		this.state |= state;
	}

	hasState(state) {
		return (this.state & state) == state;
	}

	removeState(state) {
		this.state &= (1 << state / 2); // todo fix this
	}

	hasFlag(flag) {
		return this.flags.hasflag(flag);
	}

	setFlag(flag) {
		this.flags.setFlag(flag);
	}

	resetFlag(flag) {
		this.flags.resetFlag(flag);
	}

	switchFlag(flag1, flag2) {
		this.flags.switchFlag(flag1, flag2);
	}

	remove() {
		this.parent.removeGameObject(this);
	}

	// adds a new game object into the scene
	addGameObject(obj) {
		obj.scene = this.scene;
		obj.parent = this;
		this.objectsToAdd.push(obj);
	}

	// removes given game object as soon as the update cycle finishes
	removeGameObject(obj) {
		obj.state = STATE_INACTIVE;
		this.objectsToRemove.push(obj);
	}


	addComponent(component) {
		component.owner = this;
		component.scene = this.scene;
		this.componentsToAdd.push(component);
	}

	removeComponent(component) {
		this.componentsToRemove.push(obj);
	}

	removeAllComponents() {
		for (let cmp of this.components) {
			this.removeComponent(cmp);
		}
	}

	// removes an existing component
	removeComponent(component) {
		for (var i = 0; i < this.components.length; i++) {
			if (this.components[i] == component) {
				this.components.splice(i, 1);
				if (this.scene != null) {
					this.scene._removeComponent(component);
				}
				return true;
			}
		}
		return false;
	}

	// adds a new attribute
	addAttribute(key, val) {
		this.attributes.set(key, val);
	}

	// gets attribute by key
	getAttribute(key) {
		return this.attributes.get(key);
	}

	// removes an existing attribute
	removeAttribute(key) {
		this.attributes.delete(key);
	}

	update(delta, absolute) {
		if (this.hasState(STATE_UPDATABLE)) {
			this.submitChanges(false);

			this.mesh._updateTransform(this.trans);
			this.trans._updateTransform(this.parent == null ? null : this.parent.trans);

			for (let component of this.components) {
				component.update(delta, absolute);
			}

			for (let [key, val] of this.children) {
				val.update(delta, absolute);
			}
		}
	}

	draw(ctx) {
		if (this.hasState(STATE_DRAWABLE)) {
			for (let component of this.components) {
				component.draw(ctx)
			}
		}
		// children are drawn via scene
	}

	// adds pending objects
	_addPendingGameObjects(submitChanges = true) {
		for (let obj of this.objectsToAdd) {
			// set it in both addGameObject and _addPendingGameObject since
			// the parent might not had its scene assigned
			obj.scene = this.scene;
			obj.parent = this;
			this.children.set(obj.id, obj);
			this.scene._addGameObject(obj);

			if (submitChanges) {
				obj.submitChanges(false);
			}
		}

		this.objectsToAdd = [];
	}

	// removes pending objects;
	_removePendingGameObjects(submitChanges = true) {
		for (let obj of this.objectsToRemove) {
			obj.removeAllComponents();
			obj.submitChanges(false);
			this.scene._removeGameObject(obj);
			this.children.delete(obj.id);
			obj.parent = null;
			obj.scene = null;

			if (submitChanges) {
				obj.submitChanges(false);
			}
		}

		this.objectsToRemove = [];
	}

	_addPendingComponents() {
		for (let obj of this.componentsToAdd) {
			obj.owner = this;
			obj.scene = this.scene;
			this.components.push(obj);
			obj.oninit();
		}

		this.componentsToAdd = [];
	}

	// removes all components that are to be removed
	_removePendingComponents() {
		for (let component of this.componentsToRemove) {
			component.finalize();

			for (var i = 0; i < this.components.length; i++) {
				if (this.components[i] == component) {
					this.components.splice(i, 1);
					this.scene._removeComponent(component);
					break;
				}
			}
		}
		this.componentsToRemove = [];
	}
}
GameObject.idCounter = 0; // static idCounter


// Message entity that keeps custom data, a source object and component
class Msg {
	constructor(action, component, gameObject, data) {
		/**
         * Action type identifier
         * @type {any}
         */
		this.action = action;
		/**
         * Component that sent this message
         * @type {Component}
         */
		this.component = component;
		/**
         * GameObject attached to this message
         * @type {GameObject}
         */
		this.gameObject = gameObject;
		/**
         * Data payload
         * @type {any}
         */
		this.data = data;
	}
}

// Component that defines functional behavior of the game object (or its part)
class Component {

	constructor() {
		/**
         * Component identifier, set automatically
         * @type {number}
         */
		this.id = Component.idCounter++;
		/**
         * Owner game object
         * @type {GameObject}
         */
		this.owner = null;
		/**
         * Game scene
         * @type {Scene}
         */
		this.scene = null;
		/**
         * A custom action invoked upon finish
         * @type {action}
         */
		this.onFinished = null; // onFinished event
	}

	// called whenever the component is added to the scene
	oninit() {
		// override
	}

	// subscribes itself as a listener for action with given key
	subscribe(action) {
		this.scene._subscribeComponent(action, this);
	}

	// sends message to all subscribers
	sendmsg(action, data) {
		this.scene._sendmsg(new Msg(action, this, this.owner, data));
	}

	// handles incoming message
	onmessage(msg) {
		// override
	}

	// invokes update cycle
	update(delta, absolute) {
		// override
	}

	// invokes drawing cycle
	draw(ctx) {
		// override
	}

	// called whenever the component is to be removed
	finalize() {
		// override
	}

	// finishes this component
	finish() {
		this.owner.removeComponent(this);

		if (this.onFinished != null) {
			this.onFinished(this); // call the event
		}
	}
}

Component.idCounter = 0;
