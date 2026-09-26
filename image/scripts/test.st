"Load TapeDeck (like load.st), run the TapeDeck test suites, print
'N run, P passed, F failed, E errors' and the failures, and quit with status 1 on failure.
Also fails when a TapeDeck method refers to an undeclared variable or a test leaves a server running.

	pharo Pharo.image st image/scripts/test.st
	TAPEDECK_FIXTURES=/abs/fixtures/store pharo Pharo.image st image/scripts/test.st"

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
!

| out serverProcesses undeclared classes suite result problems exitCode |
out := Stdio stdout.
serverProcesses := [
	(Process allSubInstances select: [ :each |
		each isTerminated not and: [ each name notNil and: [ each name includesSubstring: 'HTTP port' ] ] ]) size ].
undeclared := ((Smalltalk allClasses select: [ :each | each name beginsWith: 'Td' ])
	flatCollect: [ :each | each methods , each class methods ])
		select: [ :each | (each respondsTo: #usesUndeclareds) and: [ each usesUndeclareds ] ].
undeclared do: [ :each | out nextPutAll: 'UNDECLARED variable in ' , each printString; lf ].
classes := (TestCase allSubclasses select: [ :each |
	(each package name beginsWith: 'TapeDeck') and: [ each isAbstract not ] ]) asArray
		sorted: [ :a :b | a name <= b name ].
problems := serverProcesses value.
suite := TestSuite named: 'TapeDeck'.
classes do: [ :each | suite addTests: each suite tests ].
result := suite run.
problems := serverProcesses value - problems.
out
	nextPutAll: ('{1} run, {2} passed, {3} failed, {4} errors' format: {
		result runCount. result passedCount. result failureCount. result errorCount });
	nextPutAll: (((result respondsTo: #skippedCount) and: [ result skippedCount > 0 ])
		ifTrue: [ ', ' , result skippedCount printString , ' skipped' ]
		ifFalse: [ '' ]);
	lf.
(result failures asArray , result errors asArray) do: [ :each |
	| reason |
	reason := [ each runCase. 'passed when run again' ]
		on: TestFailure , Error
		do: [ :exception | exception class name , ': ' , exception messageText asString ].
	out nextPutAll: '  ' , each class name , '>>' , each selector , ': ' , reason; lf ].
problems > 0 ifTrue: [ out nextPutAll: 'Servers left running by the tests: ' , problems printString; lf ].
exitCode := (result failureCount + result errorCount + undeclared size + problems) = 0
	ifTrue: [ 0 ]
	ifFalse: [ 1 ].
out flush.
(Smalltalk respondsTo: #exit:)
	ifTrue: [ Smalltalk exit: exitCode ]
	ifFalse: [ Smalltalk snapshot: false andQuit: true ].
