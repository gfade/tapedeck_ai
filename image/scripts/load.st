"Load TapeDeck into the current image from its Tonel sources.

The sources are $TAPEDECK_SRC, else image/src under the working directory, else src next to it,
else src next to the image's directory (image/pharo/../src). The Metacello group is
$TAPEDECK_GROUP, else 'gt' in Glamorous Toolkit and 'default' elsewhere.

	pharo Pharo.image st --save --quit image/scripts/load.st"

| environment candidates source group |
environment := Smalltalk os environment.
candidates := OrderedCollection new.
(environment at: 'TAPEDECK_SRC' ifAbsent: [ nil ]) ifNotNil: [ :path | candidates add: path asFileReference ].
candidates
	add: FileSystem workingDirectory / 'image' / 'src';
	add: FileSystem workingDirectory / 'src';
	add: FileLocator imageDirectory asFileReference parent / 'src'.
source := candidates detect: [ :each | (each / 'BaselineOfTapeDeck') isDirectory ] ifNone: [ nil ].
source ifNil: [
	Stdio stderr nextPutAll: 'TapeDeck sources not found: set TAPEDECK_SRC to .../tapedeck/image/src'; lf; flush.
	Smalltalk exit: 1 ].
group := environment at: 'TAPEDECK_GROUP' ifAbsent: [
	(Smalltalk globals includesKey: #GtPhlowView) ifTrue: [ 'gt' ] ifFalse: [ 'default' ] ].
Metacello new
	baseline: 'TapeDeck';
	repository: 'tonel://' , source fullName;
	onConflictUseIncoming;
	onWarningLog;
	load: group.
Stdio stdout nextPutAll: 'TapeDeck loaded (group ' , group , ') from ' , source fullName; lf; flush.
